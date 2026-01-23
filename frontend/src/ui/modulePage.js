import { MODULES } from "../data/modules.js";
import { BACKEND_BASE_URL } from "../core/config.js";
import { render } from "../app/render.js";
import { renderExtractFramesFields, setupExtractFramesForm } from "./forms/extractFrames.js";
import { renderQrcodeFields, setupQrcodeForm } from "./forms/qrcode.js";
import { setupVideoCropperForForm } from "./forms/videoCropper.js";

/**
 * 生成面包屑导航。
 * @param {{name:string}} module
 * @returns {string}
 */
const renderBreadcrumbs = (module) => `
  <nav class="breadcrumbs">
    <a class="breadcrumbs__item" href="#" data-link="home">首页</a>
    <span class="breadcrumbs__item">${module.name}</span>
  </nav>
`;

/**
 * 生成标签区块。
 * @param {{tags:Array<{label:string}>,endpoint:string}} module
 * @returns {string}
 */
const renderMeta = (module) => `
  <div class="module-detail__meta">
    ${module.tags.map((tag) => `<span class="module-detail__meta-item">${tag.label}</span>`).join("")}
    <span class="module-detail__meta-item">API: ${module.endpoint}</span>
    <span class="module-detail__meta-item">后端: ${BACKEND_BASE_URL}</span>
  </div>
`;

/**
 * 生成字段输入控件。
 * @param {{id:string,type:string,label:string,required?:boolean,placeholder?:string,description?:string,options?:string[],accept?:string}} field
 * @returns {string}
 */
const renderField = (field) => {
  const baseAttributes = `name="${field.id}" id="${field.id}" ${field.required ? "required" : ""}`;
  const hint = field.description ? `<p class="form__hint">${field.description}</p>` : "";

  switch (field.type) {
    case "textarea":
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <textarea class="textarea" ${baseAttributes} placeholder="${field.placeholder ?? ""}"></textarea>
          ${hint}
        </div>
      `;
    case "select":
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <select class="select" ${baseAttributes}>
            ${(field.options ?? []).map((option) => `<option value="${option}">${option}</option>`).join("")}
          </select>
          ${hint}
        </div>
      `;
    case "file":
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <input class="input" type="file" ${baseAttributes} ${field.accept ? `accept="${field.accept}"` : ""} />
          ${hint}
        </div>
      `;
    default:
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <input class="input" type="${field.type}" ${baseAttributes} placeholder="${field.placeholder ?? ""}" />
          ${hint}
        </div>
      `;
  }
};

/**
 * 渲染模块页面。
 * @param {string} moduleId
 * @returns {void}
 */
export const renderModule = (moduleId) => {
  const target = MODULES.find((item) => item.id === moduleId);
  if (!target) {
    render(
      `<div class="empty">
        <p>未找到对应模块。</p>
        <button class="button button--ghost" data-link="home">返回首页</button>
      </div>`
    );
    return;
  }

  const fields =
    target.id === "extract-frames" || target.id === "mp4-to-gif"
      ? renderExtractFramesFields(target)
      : target.id === "qrcode-generator"
        ? renderQrcodeFields(target)
        : target.fields.map(renderField).join("");

  render(`
    ${renderBreadcrumbs(target)}
    <section class="module-detail">
      <header class="module-detail__header">
        <h2 class="module-detail__title">${target.name}</h2>
        <p class="module-detail__desc">${target.description}</p>
        ${renderMeta(target)}
      </header>
      <div class="module-detail__body">
        <form class="form form-card" data-module-form="${target.id}" autocomplete="off">
          ${fields}
          <div class="form__actions">
            <button class="button" type="submit">提交任务</button>
            <button class="button button--ghost" type="button" data-link="home">取消</button>
          </div>
          <div class="status status--info" hidden data-status-panel>
            <span class="status__text">等待提交</span>
            <span class="status__meta"></span>
          </div>
          <div class="result" hidden data-result-panel>
            <h3 class="result__title" data-result-title>处理结果</h3>
            <p class="result__meta" data-result-meta></p>
            <div class="result__actions" data-result-actions></div>
            <div class="result__previews" hidden data-result-previews></div>
            <div class="result__files" hidden data-result-files>
              <details>
                <summary class="result__files-summary">查看生成文件</summary>
                <ul class="result__file-list" data-result-file-list></ul>
              </details>
            </div>
          </div>
        </form>
      </div>
    </section>
  `);

  if (target.id === "extract-frames" || target.id === "mp4-to-gif") {
    const formEl = document.querySelector(`[data-module-form="${target.id}"]`);
    setupExtractFramesForm(formEl);
  } else if (target.id === "qrcode-generator") {
    const formEl = document.querySelector(`[data-module-form="${target.id}"]`);
    setupQrcodeForm(formEl);
  }

  // 通用能力：为所有含视频上传的表单挂载“框选裁剪”组件（若无视频输入则自动 no-op）
  const formEl = document.querySelector(`[data-module-form="${target.id}"]`);
  setupVideoCropperForForm(formEl);
};

