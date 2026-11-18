export type BlockAlignment = 'left' | 'center' | 'right' | 'justify';

export type ChoiceLayoutMode = 'table' | 'tabs';

export type MathOutputFormat = 'omml' | 'latex';

export type OcrSpeedMode = 'fast' | 'accurate';

export interface TabStopSpec {
  pos_pt?: number | null;
  align: 'left' | 'center' | 'right';
  leader?: 'none' | 'dot' | 'underscore';
  weight?: number | null;
  fixed_width_pt?: number | null;
}

export interface InlineSegment {
  type: 'text' | 'math';
  content: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font_size_pt?: number | null;
  color?: string | null;
  tab_before?: boolean;
  tab_leader?: 'none' | 'dot' | 'underscore';
  tab_weight?: number;
  tab_width_pt?: number;
}

export interface TableCellData {
  segments: InlineSegment[];
  blocks?: DocumentBlock[] | null;
  is_header?: boolean;
  alignment?: BlockAlignment | null;
  v_align?: 'top' | 'center' | 'bottom' | null;
  width_pct?: number | null;
  col_span?: number | null;
  border_top?: boolean | null;
  border_bottom?: boolean | null;
  border_left?: boolean | null;
  border_right?: boolean | null;
  border_color?: string | null;
  fill_color?: string | null;
}

export interface DocumentBlock {
  block_type: 'heading' | 'paragraph' | 'equation' | 'table' | 'figure' | 'horizontal_rule';
  alignment: BlockAlignment;
  heading_level?: number | null;
  segments?: InlineSegment[] | null;
  latex?: string | null;
  table_rows?: TableCellData[][] | null;
  table_borderless?: boolean | null;
  table_style?: 'grid' | 'booktabs' | 'borderless' | 'box' | null;
  table_col_borders?: boolean[] | null;
  is_choice_block?: boolean | null;
  preserve_col_count?: boolean | null;
  box_2d?: number[] | null;
  font_size_pt?: number | null;
  line_spacing?: number | null;
  space_before_pt?: number | null;
  indent_left_pt?: number | null;
  first_line_indent_pt?: number | null;
  tab_stops_pt?: number[] | null;
  tab_stop_specs?: TabStopSpec[] | null;
  caption?: string | null;
  croppedImageDataUrl?: string | null;
  croppedWidthPx?: number | null;
  croppedHeightPx?: number | null;
}

export interface PageExtraction {
  pageNumber: number;
  pageWidthPx?: number;
  pageHeightPx?: number;
  page_size?: 'a4' | 'a5' | 'letter' | null;
  is_landscape?: boolean | null;
  margin_top_pt?: number | null;
  margin_right_pt?: number | null;
  margin_bottom_pt?: number | null;
  margin_left_pt?: number | null;
  base_font_size_pt?: number | null;
  default_line_spacing?: number | null;
  blocks: DocumentBlock[];
}

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  ocrDataUrl?: string;
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
