export interface OcrBlock {
  type: 'heading' | 'paragraph' | 'display_math' | 'figure' | 'list_item';
  alignment: 'left' | 'center' | 'right' | 'justify';
  text?: string;
  level?: number;
  figure_id?: string;
  bbox_norm?: number[];
  caption?: string;
}

export interface RenderedPage {
  pageIndex: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PageResult {
  pageIndex: number;
  blocks: OcrBlock[];
}

export interface CroppedFigure {
  key: string;
  figureId: string;
  pageNum: number;
  base64Png: string;
  widthPx: number;
  heightPx: number;
  bboxNorm?: number[];
  caption?: string;
}

export interface StatusLogItem {
  id: string;
  label: string;
  state: 'running' | 'done' | 'error';
}

export interface StreamlitFile {
  name: string;
  language: string;
  content: string;
}
