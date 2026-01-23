import { MODULES } from "../data/modules.js";
import { renderHome } from "../ui/home.js";
import { renderModule } from "../ui/modulePage.js";

/**
 * 路由解析并渲染对应视图。
 * @returns {void}
 */
export const resolveRoute = () => {
  const hash = window.location.hash;
  if (hash.startsWith("#/module/")) {
    const rawId = hash.replace("#/module/", "");
    const moduleId = rawId.split("?")[0];
    const module = MODULES.find((item) => item.id === moduleId);
    // 如果模块有外部链接，直接跳转
    if (module?.externalUrl) {
      window.location.href = module.externalUrl;
      return;
    }
    renderModule(moduleId);
  } else {
    renderHome();
  }
};

