import React, { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { Check, Copy, Download, FileCode2, Package } from 'lucide-react';
import type { StreamlitFile } from '../types';

export const StreamlitCodeView: React.FC = () => {
  const [files, setFiles] = useState<StreamlitFile[]>([]);
  const [activeFile, setActiveFile] = useState<string>('app.py');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    fetch('/api/streamlit-bundle')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Không thể tải mã nguồn Streamlit.');
        }
        return res.json();
      })
      .then((data) => {
        if (active) {
          setFiles(data.files || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const currentFile = files.find((f) => f.name === activeFile) ?? files[0];

  const handleCopy = async () => {
    if (!currentFile) return;
    await navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadSingle = () => {
    if (!currentFile) return;
    const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (files.length === 0) return;
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'math2docx_streamlit_app.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="h-64 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-6 text-sm">
          {error}
        </div>
      </div>
    );
  }

  const lines = currentFile ? currentFile.content.split('\n') : [];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Mã nguồn Streamlit hoàn chỉnh cho Python
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Sẵn sàng triển khai lên Streamlit Community Cloud với PyMuPDF, python-docx, pypandoc và Google Gemini OCR.
          </p>
        </div>

        <button
          onClick={handleDownloadZip}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Package className="w-4 h-4" />
          Tải trọn bộ (.zip)
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {files.map((file) => (
              <button
                key={file.name}
                onClick={() => setActiveFile(file.name)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeFile === file.name
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                {file.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono tabular-nums mr-2">
              {lines.length} dòng
            </span>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Đã sao chép' : 'Sao chép'}
            </button>
            <button
              onClick={handleDownloadSingle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Tải {currentFile?.name}
            </button>
          </div>
        </div>

        <div className="bg-slate-950 text-slate-100 overflow-auto max-h-[620px] p-4 text-xs leading-6 font-mono">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className="hover:bg-slate-900/70">
                  <td className="select-none pr-4 text-right text-slate-500 tabular-nums w-10 align-top">
                    {idx + 1}
                  </td>
                  <td className="whitespace-pre text-slate-100">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold text-slate-900">1. Cài đặt cục bộ</h3>
          <p className="text-slate-600 mt-1.5 text-xs leading-relaxed">
            Chạy <code className="bg-slate-100 px-1.5 py-0.5 rounded">pip install -r requirements.txt</code> và đảm bảo máy đã cài đặt <code className="bg-slate-100 px-1.5 py-0.5 rounded">pandoc</code>.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold text-slate-900">2. Chạy ứng dụng Streamlit</h3>
          <p className="text-slate-600 mt-1.5 text-xs leading-relaxed">
            Khởi chạy bằng lệnh <code className="bg-slate-100 px-1.5 py-0.5 rounded">streamlit run app.py</code> và nhập Gemini API Key hoặc cấu hình trong <code className="bg-slate-100 px-1.5 py-0.5 rounded">st.secrets</code>.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold text-slate-900">3. Deploy Streamlit Cloud</h3>
          <p className="text-slate-600 mt-1.5 text-xs leading-relaxed">
            Đẩy cả 3 file <code className="bg-slate-100 px-1.5 py-0.5 rounded">app.py</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded">requirements.txt</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded">packages.txt</code> lên GitHub để triển khai tự động.
          </p>
        </div>
      </div>
    </div>
  );
};
