import { MODULES } from "../data/modules.js";
import { render } from "../app/render.js";

/**
 * 格式化统计数据。
 * @returns {{total:number,media:number,automation:number}}
 */
const buildStats = () => {
  const total = MODULES.length;
  const media = MODULES.filter((item) => item.tags.some((tag) => tag.id === "media")).length;
  const automation = MODULES.filter((item) => item.tags.some((tag) => tag.id === "automation")).length;
  return { total, media, automation };
};

/**
 * 渲染首页卡片视图。
 * @returns {void}
 */
export const renderHome = () => {
  const { total, media, automation } = buildStats();
  const cards = MODULES.map(
    (module) => {
      const isExternalLink = module.externalUrl;
      const actionButton = isExternalLink
        ? `<a class="button" href="${module.externalUrl}" target="_blank" rel="noopener noreferrer">立即使用 →</a>`
        : `<button class="button" data-navigate="${module.id}">立即使用 →</button>`;
      const metaInfo = isExternalLink
        ? `<span>外部链接</span>`
        : `<span>脚本：${module.id.replace(/-/g, "_")}.py</span>`;
      return `
      <article class="module-card" data-module="${module.id}">
        <div class="module-card__header">
          <h3 class="module-card__title">${module.name}</h3>
          <p class="module-card__summary">${module.summary}</p>
          <div class="module-card__tags">
            ${module.tags.map((tag) => `<span class="tag">${tag.label}</span>`).join("")}
          </div>
        </div>
        <div class="module-card__meta">
          ${metaInfo}
        </div>
        <div class="module-card__actions">
          ${actionButton}
        </div>
      </article>
    `;
    }
  ).join("");

  render(`
    <section class="hero">
      <div>
        <h2>脚本服务概览</h2>
        <p>根据当前仓库脚本自动生成的前端界面，点击即可进入具体操作。</p>
      </div>
      <div class="hero__summary">
        <div class="hero__chip">
          <span class="hero__chip-title">总计脚本</span>
          <span class="hero__chip-value">${total}</span>
        </div>
        <div class="hero__chip">
          <span class="hero__chip-title">媒体处理</span>
          <span class="hero__chip-value">${media}</span>
        </div>
        <div class="hero__chip">
          <span class="hero__chip-title">自动化工具</span>
          <span class="hero__chip-value">${automation}</span>
        </div>
      </div>
    </section>
    <section class="section">
      <h2 class="section__title">脚本模块</h2>
      <div class="module-grid">${cards}</div>
    </section>
  `);
};

