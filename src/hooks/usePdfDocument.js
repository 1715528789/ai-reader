/**
 * PDF 文档加载 hook：负责把文件记录（含 Blob）解析成 pdf.js 文档对象。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPdfDocument, destroyPdfDocument, clearPageTextStore } from '../lib/pdf';

const INITIAL = { pdfDoc: null, numPages: 0, loading: false, error: null };

/**
 * 加载 PDF 文档。
 * @param {object|null} source 文件记录 {id, blob, name, size, lastPage}
 * @returns {{pdfDoc: object|null, numPages: number, loading: boolean, error: string|null, close: () => void}} 状态与关闭方法
 */
export function usePdfDocument(source) {
  const [state, setState] = useState(INITIAL);
  const docRef = useRef(null);

  useEffect(() => {
    if (!source || !source.blob) {
      if (docRef.current) {
        destroyPdfDocument(docRef.current);
        docRef.current = null;
      }
      clearPageTextStore();
      setState(INITIAL);
      return undefined;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const buffer = await source.blob.arrayBuffer();
        const doc = await loadPdfDocument(buffer);
        if (cancelled) {
          destroyPdfDocument(doc);
          return;
        }
        if (docRef.current && docRef.current !== doc) {
          destroyPdfDocument(docRef.current);
        }
        docRef.current = doc;
        clearPageTextStore();
        setState({ pdfDoc: doc, numPages: doc.numPages || 0, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          pdfDoc: null,
          numPages: 0,
          loading: false,
          error: String(err?.message || err || 'PDF 解析失败'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(
    () => () => {
      if (docRef.current) {
        destroyPdfDocument(docRef.current);
        docRef.current = null;
      }
    },
    []
  );

  const close = useCallback(() => {
    if (docRef.current) {
      destroyPdfDocument(docRef.current);
      docRef.current = null;
    }
    clearPageTextStore();
    setState(INITIAL);
  }, []);

  return { ...state, close };
}

export default usePdfDocument;
