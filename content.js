(() => {
  const messageFlag = "__boothProductListingAutofillInstalled";
  if (window[messageFlag]) {
    return;
  }
  window[messageFlag] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "BOOTH_AUTOFILL") {
      return false;
    }

    handleAutofill(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));

    return true;
  });

  async function handleAutofill(payload) {
    const product = payload?.product;
    if (!product?.title || !product?.description) {
      throw new Error("商品名または商品紹介本文がありません。");
    }

    const results = [];
    results.push(setTitle(product.title));
    results.push(await setDescription(product));

    if (payload.images?.length) {
      results.push(await setImages(payload.images));
    }

    const filled = results.filter(Boolean);
    if (!filled.length) {
      throw new Error("入力できるフォーム項目を見つけられませんでした。BOOTH 管理画面の DOM が変わっている可能性があります。");
    }

    if (payload.autoSave) {
      const clicked = clickSaveButton();
      filled.push(clicked ? "保存ボタンをクリック" : "保存ボタンは未検出");
    }

    return {
      message: `入力完了: ${filled.join(" / ")}`
    };
  }

  function setTitle(title) {
    const input = findTextInput([
      "商品名",
      "タイトル",
      "name",
      "title"
    ]);
    if (!input) {
      return "";
    }

    setElementValue(input, title);
    return "商品名";
  }

  async function setDescription(product) {
    const blocks = Array.isArray(product.descriptionBlocks) ? product.descriptionBlocks : [];
    const textarea = findTextarea([
      "商品紹介",
      "商品説明",
      "紹介文",
      "description",
      "body"
    ]);
    if (!textarea) {
      return "";
    }

    const overview = product.summary || blocks.find((block) => !block.heading)?.body || "";
    setElementValue(textarea, overview);
    const paragraphBlocks = blocks.filter((block) => block.heading);

    if (paragraphBlocks.length && await setDescriptionParagraphs(paragraphBlocks, textarea)) {
      return `商品紹介（概要 + ${paragraphBlocks.length} 段落）`;
    }

    return paragraphBlocks.length
      ? "商品紹介（概要のみ、段落未検出）"
      : "商品紹介（概要）";
  }

  async function setDescriptionParagraphs(blocks, overviewTextarea) {
    const root = document.body;
    if (!root) {
      return false;
    }

    let rows = findParagraphRows(root, overviewTextarea);

    while (rows.length < blocks.length) {
      if (!clickAddParagraph(root)) {
        break;
      }
      await waitForDomUpdate();
      rows = findParagraphRows(root, overviewTextarea);
    }

    if (rows.length < blocks.length) {
      return false;
    }

    for (let index = 0; index < blocks.length; index += 1) {
      const row = rows[index];
      const block = blocks[index];
      if (row.heading) {
        setElementValue(row.heading, block.heading || "");
      }
      setElementValue(row.body, block.body || "");
    }

    return true;
  }

  function findParagraphRows(root, overviewTextarea) {
    const boothRows = findBoothParagraphRows(root, overviewTextarea);
    if (boothRows.length) {
      return boothRows;
    }

    const textareas = Array.from(root.querySelectorAll("textarea"))
      .filter((textarea) => textarea !== overviewTextarea && isVisible(textarea));

    return textareas
      .map((textarea) => {
        const row = closestDistinctRow(textarea, root);
        const heading = findHeadingInput(row, textarea);
        return { element: row, heading, body: textarea };
      })
      .filter((row) => row.heading)
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.body === row.body) === index);
  }

  function findBoothParagraphRows(root, overviewTextarea) {
    return Array.from(root.querySelectorAll("li.js-item-module"))
      .filter((module) => {
        const header = module.querySelector(".variation-box-head");
        const text = `${header?.textContent || ""} ${module.getAttribute("aria-label") || ""}`.trim();
        return /段落|Paragraph/i.test(text);
      })
      .map((module) => {
        const body = Array.from(module.querySelectorAll("textarea"))
          .find((textarea) => textarea !== overviewTextarea && isVisible(textarea));
        const inputs = Array.from(module.querySelectorAll("input:not([type]), input[type='text']"))
          .filter((input) => isVisible(input));
        const heading = inputs.find((input) => {
          const context = elementContext(input).toLowerCase();
          return context.includes("見出し")
            || context.includes("title")
            || context.includes("heading");
        }) || inputs[0] || null;
        return heading && body ? { element: module, heading, body } : null;
      })
      .filter(Boolean);
  }

  function closestDistinctRow(textarea, root) {
    let node = textarea.parentElement;
    let best = node || root;
    let depth = 0;
    while (node && node !== root && depth < 5) {
      const textareaCount = node.querySelectorAll("textarea").length;
      if (textareaCount === 1) {
        best = node;
      }
      node = node.parentElement;
      depth += 1;
    }
    return best;
  }

  function findHeadingInput(row, bodyTextarea) {
    const inputs = Array.from(row.querySelectorAll("input:not([type]), input[type='text']"))
      .filter((input) => input !== bodyTextarea && isVisible(input));

    return inputs.find((input) => {
      const context = elementContext(input).toLowerCase();
      return context.includes("見出し")
        || context.includes("見出しテキスト")
        || context.includes("heading")
        || context.includes("title");
    }) || inputs[0] || null;
  }

  function clickAddParagraph(root) {
    const button = findAddParagraphButton(root);
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }

  function findAddParagraphButton(root) {
    const candidates = Array.from(root.querySelectorAll("button, input[type='button'], a"))
      .filter((element) => isVisible(element) && !element.disabled);
    return candidates.find((element) => {
      const text = `${element.textContent || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""}`.trim();
      const hasAddIcon = Boolean(element.querySelector("pixiv-icon[name*='Add'], [name*='Add']"));
      return ((/(段落|項目|紹介文|説明文|Section|Paragraph)/i.test(text)
          && (/(追加|Add|\+)/i.test(text) || hasAddIcon))
        || (/^段落$/i.test(text) && hasAddIcon));
    }) || null;
  }

  async function setImages(images) {
    const input = findImageInput();
    if (!input) {
      return "";
    }

    const files = await Promise.all(images.map(toFile));
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }

    input.files = transfer.files;
    dispatchInputEvents(input);
    return `商品画像 ${files.length} 件`;
  }

  function findTextInput(keywords) {
    const inputs = Array.from(document.querySelectorAll("input:not([type]), input[type='text'], input[type='search']"));
    return findByKeywords(inputs, keywords);
  }

  function findTextarea(keywords) {
    const textareas = Array.from(document.querySelectorAll("textarea"));
    return findByKeywords(textareas, keywords);
  }

  function findImageInput() {
    const inputs = Array.from(document.querySelectorAll("input[type='file']"));
    return inputs.find((input) => {
      const accept = (input.getAttribute("accept") || "").toLowerCase();
      const context = elementContext(input).toLowerCase();
      return accept.includes("image") || context.includes("画像") || context.includes("image");
    }) || inputs[0] || null;
  }

  function findByKeywords(elements, keywords) {
    const lowered = keywords.map((keyword) => keyword.toLowerCase());
    return elements.find((element) => {
      const context = elementContext(element).toLowerCase();
      return lowered.some((keyword) => context.includes(keyword));
    }) || null;
  }

  function elementContext(element) {
    const parts = [
      element.id,
      element.name,
      element.placeholder,
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      labelText(element),
      ancestorText(element)
    ];
    return parts.filter(Boolean).join(" ");
  }

  function labelText(element) {
    const labels = [];
    if (element.id) {
      labels.push(...Array.from(document.querySelectorAll(`label[for='${cssEscape(element.id)}']`)));
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      labels.push(wrappingLabel);
    }
    return labels.map((label) => label.textContent || "").join(" ");
  }

  function ancestorText(element) {
    let node = element.parentElement;
    const chunks = [];
    let depth = 0;
    while (node && depth < 4) {
      const ownText = Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (ownText) {
        chunks.push(ownText);
      }
      node = node.parentElement;
      depth += 1;
    }
    return chunks.join(" ");
  }

  function setElementValue(element, value) {
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor.set.call(element, value);
    dispatchInputEvents(element);
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }

  function waitForDomUpdate() {
    return new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  }

  async function toFile(image) {
    const response = await fetch(image.dataUrl);
    const blob = await response.blob();
    return new File([blob], image.name, { type: image.type || blob.type || "image/png" });
  }

  function clickSaveButton() {
    const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], a"));
    const saveButton = candidates.find((element) => {
      const text = `${element.textContent || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""}`.trim();
      return /(保存|更新|変更を保存|Save|Update)/i.test(text) && !element.disabled;
    });

    if (!saveButton) {
      return false;
    }

    saveButton.click();
    return true;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return CSS.escape(value);
    }
    return value.replace(/['"\\]/g, "\\$&");
  }
})();
