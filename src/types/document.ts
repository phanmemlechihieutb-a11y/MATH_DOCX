export type BlockAlignment = 'left' | 'center' | 'right' | 'justify';

export type ChoiceLayoutMode = 'table' | 'tabs';

export interface InlineSegment {
  type: 'text' | 'math';
  content: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font_size_pt?: number | null;
  color?: string | null;
  tab_before?: boolean;
}

export interface TableCellData {
  segments: InlineSegment[];
  is_header?: boolean;
  alignment?: BlockAlignment | null;
  width_pct?: number | null;
  col_span?: number | null;
}

export interface DocumentBlock {
  block_type: 'heading' | 'paragraph' | 'equation' | 'table' | 'figure' | 'horizontal_rule';
  alignment: BlockAlignment;
  heading_level?: number | null;
  segments?: InlineSegment[] | null;
  latex?: string | null;
  table_rows?: TableCellData[][] | null;
  table_borderless?: boolean | null;
  is_choice_block?: boolean | null;
  box_2d?: number[] | null;
  font_size_pt?: number | null;
  line_spacing?: number | null;
  indent_left_pt?: number | null;
  first_line_indent_pt?: number | null;
  tab_stops_pt?: number[] | null;
  caption?: string | null;
  croppedImageDataUrl?: string | null;
  croppedWidthPx?: number | null;
  croppedHeightPx?: number | null;
}

export interface PageExtraction {
  pageNumber: number;
  pageWidthPx?: number;
  pageHeightPx?: number;
  blocks: DocumentBlock[];
}

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ExtractedEquationItem {
  id: number;
  pageNumber: number;
  isDisplay: boolean;
  latex: string;
  ommlPreview?: string;
}
