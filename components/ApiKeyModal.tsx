import React, { useState } from 'react';

interface ApiKeyModalProps {
  onSave: (key: string) => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave }) => {
  const [inputKey, setInputKey] = useState("");
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 sm:p-8 relative">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 text-primary rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4">🔑</div>
          <h2 className="text-2xl font-bold text-slate-800">Cấu hình API Key Cá nhân</h2>
          <p className="text-slate-500 text-sm mt-2">Mỗi người dùng cần có 1 chìa khóa riêng để sử dụng miễn phí.</p>
        </div>
        
        <div className="space-y-5">
          {/* Hướng dẫn */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 space-y-2">
            <h3 className="font-bold text-slate-800 mb-2">Cách lấy Key miễn phí (1 phút):</h3>
            <p>1. Nhấn vào đường link bên dưới và đăng nhập Gmail.</p>
            <p>2. Nhấn nút màu xanh <span className="font-bold text-blue-600">"Create API key"</span>.</p>
            <p>3. Chọn <span className="font-bold">"Create API key in new project"</span>.</p>
            <p>4. Copy đoạn mã bắt đầu bằng chữ <code className="bg-slate-200 px-1 rounded text-red-600 font-mono">AIza...</code> và dán vào ô bên dưới.</p>
            
            <div className="pt-2 text-center">
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-1 text-primary hover:text-blue-700 font-bold hover:underline"
                >
                  👉 Bấm vào đây để lấy Key tại Google AI Studio
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Dán API Key của bạn vào đây:</label>
            <input 
              type="password" 
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-mono text-sm"
            />
          </div>
          
          <button 
            onClick={() => inputKey && onSave(inputKey)}
            disabled={!inputKey}
            className="w-full py-3 bg-primary hover:bg-blue-700 text-white font-bold rounded-lg transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span>Lưu & Bắt đầu sử dụng</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;