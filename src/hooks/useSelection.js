/**
 * 划词选中 hook：监听 document 的 mouseup / keyup，
 * 若选区落在容器内部，则输出选中文本与屏幕坐标（供浮层定位）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 判断节点是否在容器内。
 * @param {HTMLElement|null} container 容器
 * @param {Node|null} node 节点
 * @returns {boolean} 是否包含
 */
function containsNode(container, node) {
  if (!container || !node) return false;
  if (container === node) return true;
  if (node.nodeType === 1) return container.contains(node);
  const parent = node.parentElement;
  return parent ? container.contains(parent) : false;
}

/**
 * 划词选中 hook。
 * @param {import('react').RefObject<HTMLElement>} containerRef PDF 文本层容器
 * @param {object} options 选项
 * @param {number} [options.minLength] 最小触发长度（默认 1）
 * @param {number} [options.maxLength] 最大处理长度（默认 2000）
 * @returns {{selection: {text: string, rect: object}|null, clear: () => void, setSelection: Function}} 选中状态
 */
export function useSelection(containerRef, options = {}) {
  const { minLength = 1, maxLength = 2000 } = options;
  const [selection, setSelection] = useState(null);
  const optionsRef = useRef({ minLength, maxLength });
  optionsRef.current = { minLength, maxLength };

  const clear = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    /**
     * 读取当前选区。
     * @returns {void}
     */
    const handle = () => {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = String(sel.toString() || '').replace(/\s+/g, ' ').trim();
      const { minLength: min, maxLength: max } = optionsRef.current;
      if (!text || text.length < min) return;
      const container = containerRef.current;
      if (!containsNode(container, sel.anchorNode) && !containsNode(container, sel.focusNode)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      setSelection({
        text: text.slice(0, max),
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      });
    };

    /**
     * 鼠标按下时清空（点击在浮层上则不清空）。
     * @param {MouseEvent} event 事件
     * @returns {void}
     */
    const handleDown = (event) => {
      const target = event.target;
      if (target && target.closest && target.closest('[data-selection-popup="true"]')) return;
      setSelection(null);
    };

    document.addEventListener('mouseup', handle);
    document.addEventListener('keyup', handle);
    document.addEventListener('mousedown', handleDown);
    return () => {
      document.removeEventListener('mouseup', handle);
      document.removeEventListener('keyup', handle);
      document.removeEventListener('mousedown', handleDown);
    };
  }, [containerRef]);

  return { selection, clear, setSelection };
}

export default useSelection;
