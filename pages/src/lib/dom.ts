/**
 * Tiny DOM helpers. Not a framework. Three exported things:
 *
 *   `el(tag, props?, ...children)`  - typed createElement + attribute setting
 *   `on(target, type, handler)`     - typed addEventListener
 *   `clearChildren(node)`           - empty a node
 *
 * Property handling:
 *   - `class`        -> sets className (renamed because `class` is reserved)
 *   - `dataset`      -> Object.assign onto element.dataset
 *   - `style`        -> Object.assign onto element.style
 *   - everything else is set as a property on the element (works for value,
 *     disabled, type, placeholder, etc.); attributes that don't have a
 *     property mirror are not supported (we don't need any).
 */

type ElementProps<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>
> & {
  class?: string;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
};

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps<K> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    const { class: className, dataset, style, ...rest } = props;
    if (className !== undefined) node.className = className;
    if (dataset !== undefined) Object.assign(node.dataset, dataset);
    if (style !== undefined) Object.assign(node.style, style);
    Object.assign(node, rest);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function on<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void {
  target.addEventListener(type, handler as EventListener);
}

export function clearChildren(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
