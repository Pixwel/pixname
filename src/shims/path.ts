// The SDK's fileType.js imports Node's `path` for `extname`; this is all it needs in the webview.
export function extname(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}
export default { extname };
