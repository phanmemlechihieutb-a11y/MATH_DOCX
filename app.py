import io
import json
import os
import re
import tempfile
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
import google.generativeai as genai
import latex2mathml.converter
import pypandoc
import streamlit as st
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from google.api_core import exceptions as google_exceptions
from lxml import etree
from PIL import Image


# ==============================================================================
# CẤU HÌNH TRANG & GIAO DIỆN STREAMLIT
# ==============================================================================
st.set_page_config(
    page_title="Math2Docx — Chuyển đổi Tài liệu Toán học sang Word",
    page_icon="📐",
    layout="wide",
    initial_sidebar_state="expanded",
)

CUSTOM_CSS = """
<style>
    .main-header {
        font-size: 2rem;
        font-weight: 700;
        color: #0F172A;
        margin-bottom: 0.25rem;
    }
    .sub-header {
        font-size: 1rem;
        color: #475569;
        margin-bottom: 1.5rem;
    }
    .stProgress > div > div > div > div {
        background-color: #2563EB;
    }
    .info-box {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1rem;
    }
</style>
"""
st.markdown(CUSTOM_CSS, unsafe_allow_html=True)


# ==============================================================================
# CẤU TRÚC DỮ LIỆU & HẰNG SỐ
# ==============================================================================
OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

SUPPORTED_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
]

OCR_SYSTEM_PROMPT = """Bạn là chuyên gia số hóa tài liệu Toán học (OCR & Layout Analysis) sang cấu trúc JSON chuẩn xác để xuất ra Microsoft Word (.docx).

NHIỆM VỤ:
Phân tích trang tài liệu được cung cấp và trích xuất TOÀN BỘ nội dung theo đúng thứ tự đọc từ trên xuống dưới, giữ nguyên bố cục, canh lề, định dạng chữ và công thức toán học.

QUY TẮC BẮT BUỘC:
1. Trả về DUY NHẤT một JSON hợp lệ (không bọc trong markdown code block nếu không cần, hoặc JSON thuần) theo schema:
{
  "blocks": [
    {
      "type": "heading" | "paragraph" | "display_math" | "figure" | "list_item",
      "alignment": "left" | "center" | "right" | "justify",
      "text": "Nội dung văn bản (dùng **in đậm**, *in nghiêng*, công thức inline bọc trong $...$, công thức khối bọc trong $$...$$)",
      "level": 1,
      "figure_id": "fig_1",
      "bbox_norm": [ymin, xmin, ymax, xmax],
      "caption": "Chú thích hình nếu có"
    }
  ]
}
2. Công thức Toán học:
   - MỌI biểu thức toán học, ký hiệu toán (x, y, f(x), \\alpha, \\frac{a}{b}, \\int, \\sum, \\sqrt{}, \\vec{AB}, \\widehat{ABC}, \\triangle ABC, hệ phương trình \\begin{cases}...\\end{cases}, ma trận...) PHẢI được viết bằng LaTeX chuẩn.
   - Công thức nằm cùng dòng với chữ: bọc trong dấu đô la đơn `$...$` (ví dụ: `Cho hàm số $y = x^3 - 3x + 2$ có đồ thị $(C)$.`).
   - Công thức đứng riêng một dòng hoặc block `display_math`: viết biểu thức LaTeX sạch, đặt trong `$$...$$` hoặc để trong `text` của block `display_math`.
   - Không dùng Unicode thay cho công thức phức tạp; luôn ưu tiên LaTeX chuẩn tương thích Pandoc/Word OMML.
3. Định dạng & Canh lề:
   - Giữ nguyên in đậm `**...**` (ví dụ: `**Câu 1.**`, `**Lời giải**`, `**Định lý.**`).
   - Giữ nguyên in nghiêng `*...*`.
   - Giữ nguyên ngắt dòng `\\n` trong cùng đoạn nếu là các phương án trắc nghiệm `A.`, `B.`, `C.`, `D.` hoặc các dòng thơ/hệ ý.
   - Ghi nhận đúng `alignment`: tiêu đề thường `"center"`, đoạn văn bản thường `"justify"` hoặc `"left"`, phần ghi chú góc phải/ngày tháng `"right"`.
4. Hình vẽ, đồ thị, sơ đồ (`type: "figure"`):
   - Khi gặp hình học phẳng/không gian, đồ thị hàm số, bảng biến thiên vẽ dạng hình, sơ đồ mạch điện/hình ảnh minh họa: tạo một block `type: "figure"` đặt ĐÚNG VỊ TRÍ xuất hiện của hình trong mạch văn bản.
   - Cung cấp `bbox_norm`: `[ymin, xmin, ymax, xmax]` theo thang chuẩn hóa `0` đến `1000` (tính từ mép trên-trái của trang ảnh). Hãy khoanh vùng đủ rộng (thêm khoảng 10-15 đơn vị lề) để không cắt mất chữ cái tên đỉnh (A, B, C, O, x, y) hay trục tọa độ!
"""


@dataclass
class ExtractedFigure:
    figure_id: str
    page_num: int
    image_bytes: bytes
    bbox_norm: Optional[List[int]] = None
    caption: str = ""


# ==============================================================================
# TIỆN ÍCH API KEY & XỬ LÝ LỖI GEMINI
# ==============================================================================
def get_secret_api_key() -> str:
    """Lấy GEMINI_API_KEY an toàn từ st.secrets nếu tồn tại."""
    try:
        if hasattr(st, "secrets") and "GEMINI_API_KEY" in st.secrets:
            return str(st.secrets["GEMINI_API_KEY"]).strip()
    except Exception:
        pass
    return os.environ.get("GEMINI_API_KEY", "").strip()


def classify_gemini_error(exc: Exception) -> Tuple[str, str]:
    """Phân loại lỗi từ Gemini API để thông báo thân thiện, rõ nguyên nhân."""
    msg = str(exc)
    upper = msg.upper()

    if (
        isinstance(exc, google_exceptions.InvalidArgument)
        or "400" in msg
        or "INVALID_ARGUMENT" in upper
        or "API_KEY_INVALID" in upper
        or "API KEY NOT VALID" in upper
    ):
        return (
            "INVALID_ARGUMENT (400)",
            "API Key không hợp lệ hoặc tham số gửi lên bị sai định dạng (400 INVALID_ARGUMENT). "
            "Vui lòng kiểm tra lại Gemini API Key từ Google AI Studio.",
        )

    if (
        isinstance(exc, google_exceptions.NotFound)
        or "404" in msg
        or "NOT_FOUND" in upper
        or "IS NOT FOUND" in upper
    ):
        return (
            "NOT_FOUND (404)",
            "Không tìm thấy Model Gemini được yêu cầu hoặc Model đã ngừng hỗ trợ (404 NOT_FOUND). "
            "Hãy chọn model hợp lệ như `gemini-2.5-flash` hoặc `gemini-2.5-pro`.",
        )

    if isinstance(exc, google_exceptions.PermissionDenied) or "403" in msg or "PERMISSION_DENIED" in upper:
        return (
            "PERMISSION_DENIED (403)",
            "API Key bị từ chối quyền truy cập (403 PERMISSION_DENIED). Vui lòng kiểm tra quyền của Key hoặc Billing.",
        )

    if isinstance(exc, google_exceptions.ResourceExhausted) or "429" in msg or "RESOURCE_EXHAUSTED" in upper:
        return (
            "RESOURCE_EXHAUSTED (429)",
            "API đang vượt quá giới hạn lượt gọi (429 Quota/Rate Limit). Hệ thống sẽ tự động thử lại hoặc bạn hãy đợi ít phút.",
        )

    return ("API_ERROR", f"Lỗi kết nối Gemini API: {msg}")


def validate_gemini_api_key(api_key: str, model_name: str) -> Tuple[bool, str]:
    """Kiểm tra nhanh tính hợp lệ của API Key và Model trước khi xử lý toàn bộ tài liệu."""
    if not api_key or len(api_key.strip()) < 10:
        return False, "Vui lòng nhập Gemini API Key hợp lệ (hoặc cấu hình trong st.secrets)."

    try:
        genai.configure(api_key=api_key.strip())
        model = genai.GenerativeModel(model_name=model_name)
        # Gọi một request siêu nhẹ để xác thực cả Key (400) lẫn Model (404)
        model.generate_content(
            "OK",
            generation_config=genai.types.GenerationConfig(max_output_tokens=5),
        )
        return True, "Kết nối Gemini API thành công."
    except Exception as exc:
        code, friendly = classify_gemini_error(exc)
        return False, f"[{code}] {friendly}"


def call_gemini_ocr_with_retry(
    api_key: str,
    model_name: str,
    page_image: Image.Image,
    page_index: int,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """Gọi Gemini Vision OCR kèm cơ chế retry exponential backoff khi gặp 429/503."""
    genai.configure(api_key=api_key.strip())
    model = genai.GenerativeModel(
        model_name=model_name,
        system_instruction=OCR_SYSTEM_PROMPT,
    )

    user_prompt = (
        f"Đây là trang số {page_index + 1}. Hãy trích xuất toàn bộ nội dung văn bản, "
        "công thức Toán học (LaTeX) và tọa độ hình vẽ theo đúng định dạng JSON quy định."
    )

    last_exc: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            response = model.generate_content(
                [user_prompt, page_image],
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
            raw_text = (response.text or "").strip()
            return parse_ocr_json(raw_text)
        except Exception as exc:
            last_exc = exc
            code, friendly = classify_gemini_error(exc)
            # Lỗi Key hoặc Model không tồn tại thì dừng ngay, không retry vô ích
            if code in ("INVALID_ARGUMENT (400)", "NOT_FOUND (404)", "PERMISSION_DENIED (403)"):
                raise RuntimeError(friendly) from exc
            # Rate limit / tạm thời quá tải -> backoff
            if attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise RuntimeError(friendly) from exc

    raise RuntimeError(f"Không thể xử lý trang {page_index + 1}: {last_exc}")


def parse_ocr_json(raw_text: str) -> Dict[str, Any]:
    """Làm sạch và parse JSON từ phản hồi Gemini, hỗ trợ fallback nếu dính markdown fences."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        data = json.loads(cleaned)
        if isinstance(data, dict) and isinstance(data.get("blocks"), list):
            return data
        if isinstance(data, list):
            return {"blocks": data}
    except json.JSONDecodeError:
        # Thử tìm đoạn JSON object lớn nhất
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            try:
                data = json.loads(match.group(0))
                if isinstance(data, dict) and isinstance(data.get("blocks"), list):
                    return data
            except json.JSONDecodeError:
                pass

    # Fallback cuối cùng: giữ nguyên text thô thành 1 block để không mất dữ liệu
    return {
        "blocks": [
            {
                "type": "paragraph",
                "alignment": "left",
                "text": raw_text,
            }
        ]
    }


# ==============================================================================
# XỬ LÝ PDF & CẮT HÌNH ẢNH BẰNG PYMUPDF (FITZ)
# ==============================================================================
def render_pdf_pages_and_extract_images(
    pdf_bytes: bytes,
    dpi: int = 220,
) -> Tuple[List[Image.Image], Dict[int, List[Tuple[fitz.Rect, bytes]]]]:
    """
    Đọc file PDF bằng PyMuPDF (fitz):
    - Render từng trang thành PIL Image độ phân giải cao phục vụ OCR và crop chính xác.
    - Quét và trích xuất sẵn vùng chứa ảnh raster + cụm vector drawings trên trang PDF.
    """
    pages_pil: List[Image.Image] = []
    detected_regions_by_page: Dict[int, List[Tuple[fitz.Rect, bytes]]] = {}

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"File PDF bị hỏng hoặc không đúng định dạng: {exc}") from exc

    if doc.is_encrypted:
        doc.close()
        raise ValueError("File PDF đang được đặt mật khẩu bảo vệ. Vui lòng gỡ mật khẩu trước khi tải lên.")

    if len(doc) == 0:
        doc.close()
        raise ValueError("File PDF không có trang nào.")

    try:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            pages_pil.append(img)

            # Quét các vùng hình ảnh raster trực tiếp bằng PyMuPDF
            page_regions: List[Tuple[fitz.Rect, bytes]] = []
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                rects = page.get_image_rects(xref)
                for rect in rects:
                    if rect.width >= 24 and rect.height >= 24:
                        try:
                            clip_pix = page.get_pixmap(clip=rect, dpi=250, alpha=False)
                            page_regions.append((rect, clip_pix.tobytes("png")))
                        except Exception:
                            continue

            # Gom nhóm các vector drawings (đồ thị hàm số, hình học) nếu đủ lớn
            try:
                drawings = page.get_drawings()
                vector_rects = [
                    d["rect"]
                    for d in drawings
                    if d.get("rect") and 3 < d["rect"].width < page.rect.width * 0.92
                    and 3 < d["rect"].height < page.rect.height * 0.85
                ]
                merged_vectors = merge_nearby_rects(vector_rects, margin=14.0)
                for vrect in merged_vectors:
                    if vrect.width >= 45 and vrect.height >= 45:
                        padded = expand_rect(vrect, page.rect, pad=10.0)
                        clip_pix = page.get_pixmap(clip=padded, dpi=250, alpha=False)
                        page_regions.append((padded, clip_pix.tobytes("png")))
            except Exception:
                pass

            detected_regions_by_page[page_idx] = page_regions
    finally:
        doc.close()

    return pages_pil, detected_regions_by_page


def expand_rect(rect: fitz.Rect, bounds: fitz.Rect, pad: float = 10.0) -> fitz.Rect:
    """Mở rộng khung hình nhẹ để không cắt mất nhãn trục hoặc tên đỉnh."""
    return fitz.Rect(
        max(bounds.x0, rect.x0 - pad),
        max(bounds.y0, rect.y0 - pad),
        min(bounds.x1, rect.x1 + pad),
        min(bounds.y1, rect.y1 + pad),
    )


def merge_nearby_rects(rects: List[fitz.Rect], margin: float = 14.0) -> List[fitz.Rect]:
    """Hợp nhất các hình chữ nhật vẽ vector nằm gần nhau thành một sơ đồ/hình vẽ hoàn chỉnh."""
    if not rects:
        return []
    clusters: List[fitz.Rect] = []
    for r in rects:
        expanded = fitz.Rect(r.x0 - margin, r.y0 - margin, r.x1 + margin, r.y1 + margin)
        merged = False
        for i, existing in enumerate(clusters):
            if existing.intersects(expanded):
                clusters[i] = existing | r
                merged = True
                break
        if not merged:
            clusters.append(fitz.Rect(r))

    # Lặp lại 1 vòng hợp nhất dây chuyền
    changed = True
    while changed:
        changed = False
        next_clusters: List[fitz.Rect] = []
        for c in clusters:
            c_exp = fitz.Rect(c.x0 - margin, c.y0 - margin, c.x1 + margin, c.y1 + margin)
            placed = False
            for j, target in enumerate(next_clusters):
                if target.intersects(c_exp):
                    next_clusters[j] = target | c
                    placed = True
                    changed = True
                    break
            if not placed:
                next_clusters.append(c)
        clusters = next_clusters
    return clusters


def crop_figure_from_page(
    page_img: Image.Image,
    bbox_norm: Optional[List[Any]],
    pymupdf_regions: Optional[List[Tuple[fitz.Rect, bytes]]] = None,
    pdf_bytes: Optional[bytes] = None,
    page_idx: int = 0,
) -> Optional[bytes]:
    """
    Cắt hình vẽ/đồ thị từ trang gốc:
    - Nếu là PDF và có PyMuPDF vector/raster region trùng khớp cao (IoU), ưu tiên cắt trực tiếp bằng PyMuPDF ở 250 DPI để siêu nét.
    - Nếu không, dùng tọa độ chuẩn hóa [ymin, xmin, ymax, xmax] từ Gemini cắt trực tiếp từ ảnh trang.
    """
    if not bbox_norm or len(bbox_norm) != 4:
        return None

    try:
        ymin, xmin, ymax, xmax = [float(v) for v in bbox_norm]
    except (TypeError, ValueError):
        return None

    ymin = max(0.0, min(1000.0, ymin))
    xmin = max(0.0, min(1000.0, xmin))
    ymax = max(0.0, min(1000.0, ymax))
    xmax = max(0.0, min(1000.0, xmax))

    if xmax - xmin < 15 or ymax - ymin < 15:
        return None

    # Nếu có PDF gốc, thử cắt trực tiếp từ vector PDF bằng fitz.Page.get_pixmap(clip=...) để đạt độ sắc nét tuyệt đối
    if pdf_bytes is not None:
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            if 0 <= page_idx < len(doc):
                page = doc[page_idx]
                pw, ph = page.rect.width, page.rect.height
                target_rect = fitz.Rect(
                    (xmin / 1000.0) * pw,
                    (ymin / 1000.0) * ph,
                    (xmax / 1000.0) * pw,
                    (ymax / 1000.0) * ph,
                )
                # Kiểm tra xem có region PyMuPDF nào khớp sát với bbox không
                best_rect = target_rect
                if pymupdf_regions:
                    best_iou = 0.0
                    for cand_rect, _ in pymupdf_regions:
                        inter = target_rect & cand_rect
                        if not inter.is_empty:
                            inter_area = inter.get_area()
                            union_area = target_rect.get_area() + cand_rect.get_area() - inter_area
                            iou = inter_area / union_area if union_area > 0 else 0.0
                            if iou > best_iou:
                                best_iou = iou
                                best_rect = cand_rect | target_rect if iou > 0.35 else target_rect

                best_rect = expand_rect(best_rect, page.rect, pad=4.0)
                pix = page.get_pixmap(clip=best_rect, dpi=260, alpha=False)
                doc.close()
                return pix.tobytes("png")
            doc.close()
        except Exception:
            pass

    # Cắt trực tiếp trên ảnh PIL (cho PNG/JPG/JPEG hoặc fallback PDF)
    w, h = page_img.size
    left = int((xmin / 1000.0) * w)
    top = int((ymin / 1000.0) * h)
    right = int((xmax / 1000.0) * w)
    bottom = int((ymax / 1000.0) * h)

    if right - left < 16 or bottom - top < 16:
        return None

    cropped = page_img.crop((left, top, right, bottom))
    out_buf = io.BytesIO()
    cropped.save(out_buf, format="PNG")
    return out_buf.getvalue()


# ==============================================================================
# BIÊN DỊCH LATEX SANG WORD OMML (OFFICE MATH MARKUP LANGUAGE)
# ==============================================================================
def normalize_latex_for_word(latex: str) -> str:
    """Chuẩn hóa nhẹ chuỗi LaTeX để Pandoc và Word OMML biên dịch ổn định nhất."""
    s = latex.strip()
    # Loại bỏ ký tự $ bọc thừa nếu có
    if s.startswith("$$") and s.endswith("$$") and len(s) > 4:
        s = s[2:-2].strip()
    elif s.startswith("$") and s.endswith("$") and len(s) > 2:
        s = s[1:-1].strip()
    # Thay thế các lệnh hay gây lỗi nhỏ trong OMML
    s = s.replace("\\dfrac", "\\frac").replace("\\tfrac", "\\frac")
    s = s.replace("\\limits", "")
    return s


def latex_to_omml_via_pandoc(latex: str, display_mode: bool = False) -> Optional[etree._Element]:
    """
    Dùng Pandoc (pypandoc) biên dịch đoạn LaTeX sang định dạng .docx tạm,
    sau đó bóc tách phần tử XML OMML (<m:oMathPara> hoặc <m:oMath>) chuẩn Microsoft Word.
    """
    clean_tex = normalize_latex_for_word(latex)
    if not clean_tex:
        return None

    md_snippet = f"$$\n{clean_tex}\n$$" if display_mode else f"${clean_tex}$"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp_path = tmp.name

        pypandoc.convert_text(
            md_snippet,
            to="docx",
            format="markdown+tex_math_dollars",
            outputfile=tmp_path,
        )

        # Đọc word/document.xml từ file docx vừa biên dịch
        import zipfile
        with zipfile.ZipFile(tmp_path, "r") as zf:
            xml_bytes = zf.read("word/document.xml")

        root = etree.fromstring(xml_bytes)
        ns = {"m": OMML_NS}

        if display_mode:
            omath_para = root.find(".//m:oMathPara", namespaces=ns)
            if omath_para is not None:
                return omath_para

        omath = root.find(".//m:oMath", namespaces=ns)
        return omath
    except Exception:
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def mathml_node_to_omml_xml(mml_elem: etree._Element) -> str:
    """
    Bộ chuyển đổi dự phòng thuần Python: chuyển cây MathML (từ latex2mathml)
    sang XML OMML (<m:oMath>) khi Pandoc gặp công thức lạ hoặc chưa cài đặt.
    """
    tag = etree.QName(mml_elem).localname

    def esc(txt: Optional[str]) -> str:
        if not txt:
            return ""
        return (
            txt.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    def wrap_run(text: str) -> str:
        if not text:
            return ""
        return f'<m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>{esc(text)}</m:t></m:r>'

    children = [c for c in mml_elem if isinstance(c.tag, str)]

    if tag in ("math", "mrow", "mstyle", "mpadded", "mphantom"):
        return "".join(mathml_node_to_omml_xml(c) for c in children)
    if tag in ("mi", "mn", "mo", "mtext", "ms"):
        return wrap_run(mml_elem.text or "")
    if tag == "mfrac" and len(children) >= 2:
        num = mathml_node_to_omml_xml(children[0])
        den = mathml_node_to_omml_xml(children[1])
        return f"<m:f><m:num>{num}</m:num><m:den>{den}</m:den></m:f>"
    if tag == "msqrt":
        inner = "".join(mathml_node_to_omml_xml(c) for c in children)
        return f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>{inner}</m:e></m:rad>'
    if tag == "mroot" and len(children) >= 2:
        base = mathml_node_to_omml_xml(children[0])
        deg = mathml_node_to_omml_xml(children[1])
        return f"<m:rad><m:deg>{deg}</m:deg><m:e>{base}</m:e></m:rad>"
    if tag == "msup" and len(children) >= 2:
        base = mathml_node_to_omml_xml(children[0])
        sup = mathml_node_to_omml_xml(children[1])
        return f"<m:sSup><m:e>{base}</m:e><m:sup>{sup}</m:sup></m:sSup>"
    if tag == "msub" and len(children) >= 2:
        base = mathml_node_to_omml_xml(children[0])
        sub = mathml_node_to_omml_xml(children[1])
        return f"<m:sSub><m:e>{base}</m:e><m:sub>{sub}</m:sub></m:sSub>"
    if tag == "msubsup" and len(children) >= 3:
        base = mathml_node_to_omml_xml(children[0])
        sub = mathml_node_to_omml_xml(children[1])
        sup = mathml_node_to_omml_xml(children[2])
        return f"<m:sSubSup><m:e>{base}</m:e><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup></m:sSubSup>"
    if tag == "mfenced":
        open_ch = mml_elem.get("open", "(")
        close_ch = mml_elem.get("close", ")")
        inner = "".join(mathml_node_to_omml_xml(c) for c in children)
        return (
            f'<m:d><m:dPr><m:begChr m:val="{esc(open_ch)}"/><m:endChr m:val="{esc(close_ch)}"/></m:dPr>'
            f"<m:e>{inner}</m:e></m:d>"
        )
    if tag in ("mover", "munder", "munderover"):
        return "".join(mathml_node_to_omml_xml(c) for c in children)
    if tag == "mtable":
        rows_xml = []
        for row in children:
            cells_xml = [f"<m:e>{mathml_node_to_omml_xml(cell)}</m:e>" for cell in row]
            rows_xml.append(f"<m:mr>{''.join(cells_xml)}</m:mr>")
        return f"<m:m>{''.join(rows_xml)}</m:m>"

    return "".join(mathml_node_to_omml_xml(c) for c in children)


def latex_to_omml_fallback(latex: str, display_mode: bool = False) -> Optional[etree._Element]:
    """Chuyển LaTeX -> MathML (latex2mathml) -> OMML XML khi pypandoc thất bại."""
    clean_tex = normalize_latex_for_word(latex)
    if not clean_tex:
        return None
    try:
        mml_str = latex2mathml.converter.convert(clean_tex)
        mml_root = etree.fromstring(mml_str.encode("utf-8"))
        inner_omml = mathml_node_to_omml_xml(mml_root)
        omath_xml = (
            f'<m:oMath xmlns:m="{OMML_NS}" xmlns:w="{W_NS}">{inner_omml}</m:oMath>'
        )
        if display_mode:
            omath_xml = (
                f'<m:oMathPara xmlns:m="{OMML_NS}" xmlns:w="{W_NS}">{omath_xml}</m:oMathPara>'
            )
        return parse_xml(omath_xml)
    except Exception:
        return None


def append_omml_to_paragraph(paragraph, latex: str, display_mode: bool = False) -> bool:
    """
    Chuyển LaTeX thành Word Equation (OMML) và gắn trực tiếp vào đối tượng paragraph của python-docx.
    Ưu tiên Pandoc trước; fallback sang MathML->OMML; cuối cùng fallback text nếu công thức lỗi cú pháp.
    """
    omml_elem = latex_to_omml_via_pandoc(latex, display_mode=display_mode)
    if omml_elem is None:
        omml_elem = latex_to_omml_fallback(latex, display_mode=display_mode)

    if omml_elem is not None:
        # Chuyển đổi sang node lxml tương thích python-docx oxml
        xml_bytes = etree.tostring(omml_elem, encoding="utf-8")
        paragraph._p.append(parse_xml(xml_bytes))
        return True

    # Fallback an toàn để không mất dữ liệu
    run = paragraph.add_run(f" {latex} ")
    run.font.name = "Cambria Math"
    return False


# ==============================================================================
# PARSER INLINE MARKDOWN + LATEX VÀ LẮP RÁP FILE WORD (.DOCX)
# ==============================================================================
INLINE_TOKEN_PATTERN = re.compile(
    r"(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)"
)


def apply_alignment(paragraph, alignment_str: str) -> None:
    """Áp dụng canh lề đoạn văn bản khớp với tài liệu gốc."""
    mapping = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }
    paragraph.alignment = mapping.get((alignment_str or "left").lower(), WD_ALIGN_PARAGRAPH.LEFT)


def add_formatted_runs_and_math(paragraph, text: str) -> None:
    """
    Phân tách một đoạn text hỗn hợp gồm:
    - Chữ thường
    - **In đậm**
    - *In nghiêng*
    - Công thức inline $...$ hoặc $$...$$
    - Ngắt dòng \\n
    và chèn vào paragraph với font chuẩn & Equation OMML.
    """
    lines = text.split("\n")
    for line_idx, line in enumerate(lines):
        if line_idx > 0:
            paragraph.add_run().add_break()

        pos = 0
        for match in INLINE_TOKEN_PATTERN.finditer(line):
            if match.start() > pos:
                plain = line[pos:match.start()]
                run = paragraph.add_run(plain)
                run.font.name = "Times New Roman"
                run.font.size = Pt(12)

            token = match.group(0)
            if token.startswith("$$") and token.endswith("$$"):
                append_omml_to_paragraph(paragraph, token[2:-2], display_mode=False)
            elif token.startswith("$") and token.endswith("$"):
                append_omml_to_paragraph(paragraph, token[1:-1], display_mode=False)
            elif token.startswith("**") and token.endswith("**"):
                # Hỗ trợ công thức nằm bên trong đoạn in đậm nếu có
                inner = token[2:-2]
                if "$" in inner:
                    sub_pos = 0
                    for m2 in re.finditer(r"\$[^$\n]+?\$", inner):
                        if m2.start() > sub_pos:
                            r = paragraph.add_run(inner[sub_pos:m2.start()])
                            r.bold = True
                            r.font.name = "Times New Roman"
                            r.font.size = Pt(12)
                        append_omml_to_paragraph(paragraph, m2.group(0)[1:-1], display_mode=False)
                        sub_pos = m2.end()
                    if sub_pos < len(inner):
                        r = paragraph.add_run(inner[sub_pos:])
                        r.bold = True
                        r.font.name = "Times New Roman"
                        r.font.size = Pt(12)
                else:
                    r = paragraph.add_run(inner)
                    r.bold = True
                    r.font.name = "Times New Roman"
                    r.font.size = Pt(12)
            elif token.startswith("*") and token.endswith("*"):
                r = paragraph.add_run(token[1:-1])
                r.italic = True
                r.font.name = "Times New Roman"
                r.font.size = Pt(12)

            pos = match.end()

        if pos < len(line):
            r = paragraph.add_run(line[pos:])
            r.font.name = "Times New Roman"
            r.font.size = Pt(12)


def build_word_document(
    all_pages_blocks: List[Dict[str, Any]],
    figures_map: Dict[str, ExtractedFigure],
) -> bytes:
    """Tạo file Word (.docx) hoàn chỉnh từ các block OCR và ảnh đã crop."""
    doc = Document()

    # Thiết lập khổ giấy A4 và lề chuẩn tài liệu Toán học
    section = doc.sections[0]
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.75)

    # Cài đặt font mặc định Times New Roman (hỗ trợ tốt tiếng Việt)
    normal_style = doc.styles["Normal"]
    normal_style.font.name = "Times New Roman"
    normal_style.font.size = Pt(12)
    normal_style.paragraph_format.space_after = Pt(4)
    normal_style.paragraph_format.line_spacing = 1.15

    for page_idx, page_data in enumerate(all_pages_blocks):
        if page_idx > 0:
            doc.add_page_break()

        blocks = page_data.get("blocks", [])
        for block in blocks:
            b_type = (block.get("type") or "paragraph").lower()
            align = block.get("alignment", "left")
            text = (block.get("text") or "").strip()

            if b_type == "heading":
                level = int(block.get("level") or 1)
                level = max(1, min(3, level))
                p = doc.add_paragraph()
                apply_alignment(p, align)
                p.paragraph_format.space_before = Pt(8)
                p.paragraph_format.space_after = Pt(4)
                add_formatted_runs_and_math(p, text)
                for r in p.runs:
                    r.bold = True
                    r.font.size = Pt(15 if level == 1 else (13 if level == 2 else 12))
                    r.font.color.rgb = RGBColor(15, 23, 42)

            elif b_type == "display_math":
                p = doc.add_paragraph()
                apply_alignment(p, align if align in ("left", "center", "right") else "center")
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.space_after = Pt(6)
                append_omml_to_paragraph(p, text, display_mode=True)

            elif b_type == "figure":
                fig_key = f"p{page_idx}_{block.get('figure_id', '')}"
                fig_obj = figures_map.get(fig_key)
                if fig_obj and fig_obj.image_bytes:
                    p_img = doc.add_paragraph()
                    p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    p_img.paragraph_format.space_before = Pt(6)
                    p_img.paragraph_format.space_after = Pt(2)
                    try:
                        pil_fig = Image.open(io.BytesIO(fig_obj.image_bytes))
                        # Tính chiều rộng hợp lý giữ nguyên tỉ lệ, tối đa 5.2 inch
                        dpi_est = 220.0
                        width_in = min(5.2, max(1.6, pil_fig.width / dpi_est))
                        p_img.add_run().add_picture(io.BytesIO(fig_obj.image_bytes), width=Inches(width_in))
                    except Exception:
                        p_img.add_run("[Hình minh họa]").italic = True

                    caption = (block.get("caption") or fig_obj.caption or "").strip()
                    if caption:
                        p_cap = doc.add_paragraph()
                        p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        p_cap.paragraph_format.space_after = Pt(6)
                        add_formatted_runs_and_math(p_cap, f"*{caption}*")

            elif b_type == "list_item":
                p = doc.add_paragraph()
                apply_alignment(p, align)
                p.paragraph_format.left_indent = Inches(0.25)
                add_formatted_runs_and_math(p, text)

            else:
                if not text:
                    continue
                p = doc.add_paragraph()
                apply_alignment(p, align)
                add_formatted_runs_and_math(p, text)

    output_stream = io.BytesIO()
    doc.save(output_stream)
    output_stream.seek(0)
    return output_stream.getvalue()


# ==============================================================================
# GIAO DIỆN CHÍNH STREAMLIT
# ==============================================================================
def main() -> None:
    st.markdown('<div class="main-header">📐 Math2Docx — Chuyển Đổi Tài Liệu Toán Học Sang Word</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="sub-header">Chuyển đổi PDF hoặc Ảnh chụp đề thi, giáo trình Toán học sang file Microsoft Word (.docx) với công thức Equation (OMML) chỉnh sửa trực tiếp và hình vẽ tự động cắt ghép.</div>',
        unsafe_allow_html=True,
    )

    # Thanh bên (Sidebar): Cấu hình API Key & Tùy chọn
    with st.sidebar:
        st.header("🔑 Cấu hình Gemini API")
        secret_key = get_secret_api_key()
        user_api_key = st.text_input(
            "Gemini API Key",
            value="",
            type="password",
            placeholder="AIzaSy... (bỏ trống nếu dùng st.secrets)",
            help="Nhập API Key từ Google AI Studio. Nếu đã cấu hình GEMINI_API_KEY trong st.secrets thì có thể bỏ trống.",
        )
        effective_api_key = user_api_key.strip() or secret_key

        if secret_key and not user_api_key.strip():
            st.success("Đang sử dụng API Key từ `st.secrets` / biến môi trường.")
        elif user_api_key.strip():
            st.info("Đang sử dụng API Key bạn vừa nhập.")
        else:
            st.warning("Chưa phát hiện API Key. Vui lòng nhập Key để sử dụng.")

        selected_model = st.selectbox(
            "Model Gemini OCR",
            options=SUPPORTED_MODELS,
            index=0,
            help="Chọn gemini-2.5-flash để tối ưu tốc độ, hoặc gemini-2.5-pro cho đề thi công thức cực phức tạp.",
        )

        pdf_dpi = st.slider(
            "Độ phân giải đọc PDF (DPI)",
            min_value=150,
            max_value=300,
            value=220,
            step=10,
            help="DPI cao giúp nhận diện chỉ số mũ/chỉ số dưới chính xác hơn và cắt hình nét hơn.",
        )

        st.divider()
        st.caption(
            "💡 Công thức Toán học được biên dịch sang định dạng OMML chuẩn Microsoft Word bằng Pandoc + LaTeX2MathML."
        )

    # Khu vực tải lên tệp
    uploaded_file = st.file_uploader(
        "Tải lên tài liệu Toán học (PDF hoặc Ảnh chụp PNG, JPG, JPEG)",
        type=["pdf", "png", "jpg", "jpeg"],
        help="Hỗ trợ file PDF nhiều trang hoặc ảnh chụp đề thi, sách bài tập.",
    )

    if uploaded_file is not None:
        file_ext = uploaded_file.name.rsplit(".", 1)[-1].lower()
        file_bytes = uploaded_file.getvalue()

        col_info1, col_info2 = st.columns([2, 1])
        with col_info1:
            st.markdown(
                f"**Tệp đã chọn:** `{uploaded_file.name}` · **Dung lượng:** `{len(file_bytes) / 1024:.1f} KB`"
            )

        convert_clicked = st.button("🚀 Bắt đầu chuyển đổi", type="primary", use_container_width=True)

        if convert_clicked:
            if not effective_api_key:
                st.error("⚠️ Vui lòng nhập Gemini API Key ở thanh bên trái trước khi chuyển đổi.")
                return

            progress_bar = st.progress(0, text="Đang khởi tạo tiến trình...")
            all_pages_blocks: List[Dict[str, Any]] = []
            figures_map: Dict[str, ExtractedFigure] = {}
            pages_pil: List[Image.Image] = []
            pymupdf_regions: Dict[int, List[Tuple[fitz.Rect, bytes]]] = {}
            is_pdf = file_ext == "pdf"

            try:
                with st.status("Đang xử lý tài liệu Toán học...", expanded=True) as status:
                    # Bước 1: Kiểm tra API Key & Model (bắt 400 INVALID_ARGUMENT, 404 NOT_FOUND)
                    status.write("🔍 Đang xác thực Gemini API Key và Model...")
                    progress_bar.progress(8, text="Đang xác thực API Key...")
                    ok, msg = validate_gemini_api_key(effective_api_key, selected_model)
                    if not ok:
                        status.update(label="Xác thực API thất bại", state="error", expanded=True)
                        st.error(msg)
                        progress_bar.empty()
                        return

                    # Bước 2: Đọc PDF / Ảnh
                    if is_pdf:
                        status.write("📄 Đang đọc file PDF và trích xuất dữ liệu vector/ảnh bằng PyMuPDF...")
                        progress_bar.progress(20, text="Đang đọc PDF...")
                        pages_pil, pymupdf_regions = render_pdf_pages_and_extract_images(file_bytes, dpi=pdf_dpi)
                    else:
                        status.write("🖼️ Đang đọc ảnh chụp đầu vào...")
                        progress_bar.progress(20, text="Đang đọc ảnh...")
                        try:
                            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
                            pages_pil = [img]
                        except Exception as exc:
                            raise ValueError(f"Không thể mở file ảnh. File có thể bị hỏng: {exc}") from exc

                    total_pages = len(pages_pil)
                    status.write(f"✅ Đã nạp thành công {total_pages} trang tài liệu.")

                    # Bước 3: Gọi Gemini OCR từng trang + Cắt hình minh họa
                    for idx, page_img in enumerate(pages_pil):
                        step_pct = 25 + int(((idx + 0.5) / total_pages) * 50)
                        progress_bar.progress(
                            step_pct,
                            text=f"Đang xử lý công thức toán trang {idx + 1}/{total_pages}...",
                        )
                        status.write(f"🧮 Đang phân tích bố cục & nhận diện công thức toán trang {idx + 1}/{total_pages}...")

                        page_json = call_gemini_ocr_with_retry(
                            api_key=effective_api_key,
                            model_name=selected_model,
                            page_image=page_img,
                            page_index=idx,
                        )
                        all_pages_blocks.append(page_json)

                        # Trích xuất & cắt hình vẽ trong trang này
                        blocks = page_json.get("blocks", [])
                        fig_count_on_page = 0
                        for b_idx, blk in enumerate(blocks):
                            if (blk.get("type") or "").lower() == "figure":
                                fig_count_on_page += 1
                                fid = blk.get("figure_id") or f"fig_{b_idx + 1}"
                                blk["figure_id"] = fid
                                status.write(f"✂️ Đang trích xuất & cắt hình ảnh `{fid}` trên trang {idx + 1}...")
                                cropped_bytes = crop_figure_from_page(
                                    page_img=page_img,
                                    bbox_norm=blk.get("bbox_norm"),
                                    pymupdf_regions=pymupdf_regions.get(idx),
                                    pdf_bytes=file_bytes if is_pdf else None,
                                    page_idx=idx,
                                )
                                if cropped_bytes:
                                    figures_map[f"p{idx}_{fid}"] = ExtractedFigure(
                                        figure_id=fid,
                                        page_num=idx + 1,
                                        image_bytes=cropped_bytes,
                                        bbox_norm=blk.get("bbox_norm"),
                                        caption=blk.get("caption", ""),
                                    )

                    # Bước 4: Biên dịch LaTeX -> Word OMML & Lắp ráp .docx
                    progress_bar.progress(85, text="Đang chuyển đổi công thức LaTeX sang Word Equation (OMML)...")
                    status.write("⚙️ Đang biên dịch toàn bộ công thức LaTeX sang OMML và ghép hình vào file Word...")
                    docx_bytes = build_word_document(all_pages_blocks, figures_map)

                    progress_bar.progress(100, text="Hoàn tất chuyển đổi!")
                    status.update(label="✅ Chuyển đổi hoàn tất! File Word đã sẵn sàng tải xuống.", state="complete", expanded=False)

                # Lưu kết quả vào session_state để không bị mất khi bấm nút download
                st.session_state["docx_bytes"] = docx_bytes
                st.session_state["docx_filename"] = f"{uploaded_file.name.rsplit('.', 1)[0]}_converted.docx"
                st.session_state["preview_blocks"] = all_pages_blocks
                st.session_state["preview_figures"] = list(figures_map.values())

            except ValueError as val_err:
                progress_bar.empty()
                st.error(f"❌ Lỗi tệp đầu vào: {val_err}")
            except RuntimeError as api_err:
                progress_bar.empty()
                st.error(f"❌ Lỗi xử lý API: {api_err}")
            except Exception as unexpected_err:
                progress_bar.empty()
                st.error(f"❌ Đã xảy ra lỗi không mong muốn: {unexpected_err}")

    # Hiển thị nút tải xuống và xem trước nếu đã có kết quả
    if "docx_bytes" in st.session_state:
        st.divider()
        st.success("🎉 File Microsoft Word (.docx) đã được tạo thành công với các công thức Equation (OMML) chỉnh sửa được!")

        st.download_button(
            label="📥 Tải xuống file Word (.docx)",
            data=st.session_state["docx_bytes"],
            file_name=st.session_state["docx_filename"],
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            type="primary",
            use_container_width=True,
        )

        tab_preview, tab_figures = st.tabs(["📝 Xem trước nội dung & công thức", "🖼️ Hình vẽ đã tự động cắt"])
        with tab_preview:
            for p_idx, p_data in enumerate(st.session_state.get("preview_blocks", [])):
                st.markdown(f"**--- Trang {p_idx + 1} ---**")
                for blk in p_data.get("blocks", []):
                    btype = (blk.get("type") or "paragraph").lower()
                    txt = blk.get("text") or ""
                    if btype == "display_math":
                        st.latex(normalize_latex_for_word(txt))
                    elif btype == "figure":
                        st.caption(f"🖼️ [Hình minh họa: {blk.get('figure_id', '')}] {blk.get('caption', '')}")
                    elif txt:
                        st.markdown(txt)

        with tab_figures:
            figs: List[ExtractedFigure] = st.session_state.get("preview_figures", [])
            if not figs:
                st.info("Không phát hiện hình vẽ hay đồ thị riêng biệt nào trong tài liệu này.")
            else:
                cols = st.columns(min(3, len(figs)))
                for i, fig in enumerate(figs):
                    with cols[i % len(cols)]:
                        st.image(
                            fig.image_bytes,
                            caption=f"Trang {fig.page_num} — {fig.figure_id}" + (f": {fig.caption}" if fig.caption else ""),
                            use_container_width=True,
                        )


if __name__ == "__main__":
    main()
