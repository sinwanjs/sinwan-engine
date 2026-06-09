import type { SinwanComponent } from "sinwan/component";
import {
  streamPage,
  renderPage,
  renderToHydratablePage,
  hasPage,
  registerPage,
} from "sinwan/server";
import type { Context } from "./context";

export class Page {
  static async render<D extends object = {}>(
    ctx: Context,
    name: string,
    page: SinwanComponent<D>,
    data: D,
    status: number = 200,
  ): Promise<void> {
    if (!hasPage(name)) registerPage(name, page);
    if (!hasPage(name)) {
      throw new Error(`Page "${name}" not found in registry`);
    }
    const html = await renderPage(name, data);
    ctx.html(html, status);
  }

  static async hydratableRender<D extends object = {}>(
    ctx: Context,
    name: string,
    page: SinwanComponent<D>,
    data: D,
    status: number = 200,
  ): Promise<void> {
    if (!hasPage(name)) registerPage(name, page);
    if (!hasPage(name)) {
      throw new Error(`Page "${name}" not found in registry`);
    }
    const html = await renderToHydratablePage(name, data);
    ctx.html(html, status);
  }

  static streamRender<D extends object = {}>(
    ctx: Context,
    name: string,
    page: SinwanComponent<D>,
    data: D,
    status: number = 200,
  ): void {
    if (!hasPage(name)) registerPage(name, page);
    if (!hasPage(name)) {
      throw new Error(`Page "${name}" not found in registry`);
    }
    const stream = streamPage(page, data);
    ctx.stream(stream, status, "text/html; charset=UTF-8");
  }
}
