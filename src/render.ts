import { CfEmailError } from "./errors";

type RenderFn = (node: unknown, options?: { plainText?: boolean }) => Promise<string> | string;

let cached: Promise<RenderFn> | undefined;

async function loadRenderer(): Promise<RenderFn> {
  if (!cached) {
    // Non-literal specifier keeps bundlers from resolving the optional peer.
    const specifier = "@react-email/render";
    cached = import(/* @vite-ignore */ specifier)
      .then((mod: { render?: RenderFn; default?: { render?: RenderFn } }) => {
        const render = mod.render ?? mod.default?.render;
        if (typeof render !== "function") {
          throw new Error("module has no render() export");
        }
        return render;
      })
      .catch((cause: unknown) => {
        cached = undefined;
        throw new CfEmailError(
          "application_error",
          "The `react` option needs the optional peer dependency @react-email/render. Install it or pass `html`.",
          { cause },
        );
      });
  }
  return cached;
}

/** Renders a React element to html and plain text with @react-email/render. */
export async function renderReact(node: unknown): Promise<{ html: string; text: string }> {
  const render = await loadRenderer();
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })]);
  return { html, text };
}
