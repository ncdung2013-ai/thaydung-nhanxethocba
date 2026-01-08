import React, { useState, useRef, useEffect } from 'react';
import { StudentData, TeacherRole } from './types';
import StudentList from './components/StudentList';
import ApiKeyModal from './components/ApiKeyModal';
import { generateCommentsBatch, extractDataFromMedia } from './services/geminiService';
import { parseExcelData } from './services/excelService';

function App() {
  const [role, setRole] = useState<TeacherRole>(TeacherRole.SUBJECT);
  const [students, setStudents] = useState<StudentData[]>([]);
  const [subjectName, setSubjectName] = useState<string>('Toán');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check key on init, if missing show modal
    const key = localStorage.getItem('GEMINI_API_KEY');
    if (!key) {
        setShowKeyModal(true);
    }
  }, []);

  const handleSaveKey = (key: string) => {
    localStorage.setItem('GEMINI_API_KEY', key);
    setShowKeyModal(false);
    setErrorMsg(null);
  };

  // Helper to update specific student
  const updateStudent = (id: string, updates: Partial<StudentData>) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  /**
   * Generates comments for a specific list of students (or current state if null)
   */
  const executeGeneration = async (targetStudents: StudentData[], currentSubject: string) => {
    if (targetStudents.length === 0) return;
    
    setIsGenerating(true);
    setErrorMsg(null);
    // Mark all as processing first
    setStudents(prev => prev.map(s => ({ ...s, isProcessing: true })));

    try {
      const chunkSize = 30;
      // Use targetStudents for iteration source, but update state
      for (let i = 0; i < targetStudents.length; i += chunkSize) {
        const chunk = targetStudents.slice(i, i + chunkSize);
        const commentsMap = await generateCommentsBatch(chunk, role, currentSubject);
        
        setStudents(prev => prev.map(s => {
          if (commentsMap.has(s.id)) {
            return { ...s, comment: commentsMap.get(s.id)!, isProcessing: false };
          }
          // If in this chunk but no comment returned (rare error), stop processing
          if (chunk.find(c => c.id === s.id)) {
             return { ...s, isProcessing: false };
          }
          return s;
        }));
      }
    } catch (err: any) {
      console.error(err);
      if (err.message === "MISSING_API_KEY") {
         setShowKeyModal(true);
         setErrorMsg("Vui lòng nhập API Key để tiếp tục.");
      } else {
         const msg = err.message || "";
         if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
            setErrorMsg("⚠️ Hết lượt sử dụng (Quota). Vui lòng đợi 1-2 phút.");
         } else {
            setErrorMsg("Lỗi kết nối AI. Vui lòng kiểm tra lại API Key hoặc đường truyền.");
         }
      }
      setStudents(prev => prev.map(s => ({ ...s, isProcessing: false })));
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Core logic to process a file object (Excel, PDF, Image)
   */
  const processFile = async (file: File) => {
    setErrorMsg(null);
    setStudents([]);

    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    let newStudents: StudentData[] = [];
    let detectedSub: string | undefined = undefined;

    // 1. Handle Excel
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileType.includes('sheet') || fileType.includes('excel')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = parseExcelData(arrayBuffer, role);
        newStudents = result.students;
        detectedSub = result.detectedSubject;

        if (newStudents.length === 0) {
          setErrorMsg("Không tìm thấy dữ liệu hợp lệ trong file Excel.");
        }
      } catch (err) {
        setErrorMsg("Lỗi khi đọc file Excel.");
      }
    } 
    // 2. Handle Image or PDF (AI Extraction)
    else if (fileType.startsWith('image/') || fileType === 'application/pdf') {
      setIsExtracting(true);
      try {
        const reader = new FileReader();
        // Wrap reader in promise to await result
        await new Promise<void>((resolve, reject) => {
            reader.onloadend = async () => {
              const resultStr = reader.result as string;
              const base64String = resultStr.split(',')[1];
              try {
                const result = await extractDataFromMedia(base64String, fileType, role);
                if (result.students.length === 0) {
                  setErrorMsg("AI không tìm thấy thông tin học sinh. Hãy thử ảnh rõ nét hơn.");
                } else {
                  newStudents = result.students;
                  detectedSub = result.detectedSubject;
                }
                resolve();
              } catch (err: any) {
                if (err.message === "MISSING_API_KEY") {
                    setShowKeyModal(true);
                } else {
                    const msg = err.message || "";
                    if (msg.includes("429") || msg.includes("quota")) {
                       setErrorMsg("⚠️ Hết lượt sử dụng (Quota). Vui lòng đợi 1-2 phút.");
                    } else {
                       setErrorMsg(err.message || "Lỗi khi AI xử lý file.");
                    }
                }
                resolve(); 
              }
            };
            reader.readAsDataURL(file);
        });
      } catch (err) {
        setErrorMsg("Lỗi đọc file từ máy.");
      } finally {
        setIsExtracting(false);
      }
    } else {
      setErrorMsg(`Định dạng file không hỗ trợ (${fileType}). Vui lòng dùng Excel, PDF hoặc Ảnh.`);
    }

    if (newStudents.length > 0) {
      setStudents(newStudents);
      
      const subToUse = detectedSub || subjectName;
      if (detectedSub) {
          setSubjectName(detectedSub);
      }

      // AUTO GENERATE IMMEDIATELY
      executeGeneration(newStudents, subToUse);
    }
  };

  // Handle Input Change
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    e.target.value = '';
  };

  // Handle Global Paste (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (showKeyModal) return; // Disable paste if modal open
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return; 
      }
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        const file = e.clipboardData.files[0];
        processFile(file);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [role, subjectName, showKeyModal]); 

  // Single Regenerate
  const handleRegenerateSingle = async (student: StudentData) => {
    updateStudent(student.id, { isProcessing: true });
    try {
      const map = await generateCommentsBatch([student], role, subjectName);
      if (map.has(student.id)) {
        updateStudent(student.id, { comment: map.get(student.id)!, isProcessing: false });
      } else {
        updateStudent(student.id, { isProcessing: false });
      }
    } catch (err: any) {
      updateStudent(student.id, { isProcessing: false });
      if (err.message === "MISSING_API_KEY") {
          setShowKeyModal(true);
      } else {
          const msg = err.message || "";
          if (msg.includes("429") || msg.includes("quota")) {
             setErrorMsg("⚠️ Hết lượt sử dụng. Vui lòng đợi một lát.");
          } else {
             setErrorMsg("Không thể tạo lại nhận xét.");
          }
      }
    }
  };

  // Triggered when Subject changes in StudentList or "Regenerate All" clicked
  const handleRegenerateAll = (newSubject?: string) => {
      const subj = newSubject || subjectName;
      if (newSubject) setSubjectName(newSubject);
      executeGeneration(students, subj);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50 relative">

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold text-lg shadow-sm">
              AI
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight hidden sm:block">Trợ lý Nhận xét Học bạ</h1>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight sm:hidden">Trợ lý Học bạ</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-300 shadow-inner">
              <button
                onClick={() => { setRole(TeacherRole.SUBJECT); setStudents([]); }}
                className={`px-3 sm:px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 ${role === TeacherRole.SUBJECT ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}`}
              >
                GV Bộ môn
              </button>
              <button
                onClick={() => { setRole(TeacherRole.HOMEROOM); setStudents([]); }}
                className={`px-3 sm:px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 ${role === TeacherRole.HOMEROOM ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}`}
              >
                GV Chủ nhiệm
              </button>
            </div>
            
            <div className="flex items-center border-l border-slate-300 pl-3 gap-1">
                {/* Settings Key Button */}
                <button
                  onClick={() => setShowKeyModal(true)}
                  className="text-slate-400 hover:text-yellow-600 transition-colors p-2 rounded-full hover:bg-slate-100"
                  title="Cài đặt API Key"
                >
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                </button>

                {/* About Button */}
                <button 
                  onClick={() => setShowAbout(true)}
                  className="text-slate-400 hover:text-primary transition-colors p-2 rounded-full hover:bg-slate-100"
                  title="Thông tin ứng dụng"
                >
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        
        {/* Input Section */}
        {students.length === 0 && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 transition-all">
            <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                     <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                       <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center border border-slate-200">1</span>
                       Nhập dữ liệu
                     </h2>
                  </div>

                  {/* File Upload Button */}
                  <div className="relative group">
                     <label className={`
                       flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-all relative overflow-hidden
                       ${isExtracting ? 'border-blue-300 bg-blue-50' : 'border-slate-300 hover:border-primary hover:bg-slate-50'}
                     `}>
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            {isExtracting ? (
                               <div className="flex flex-col items-center gap-2">
                                  <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                  <p className="text-sm text-primary font-medium">Đang phân tích hình ảnh bằng AI...</p>
                                  <p className="text-xs text-slate-500 font-normal">Quá trình này có thể mất vài giây</p>
                                </div>
                            ) : (
                               <>
                                <div className="flex items-center gap-3 mb-3">
                                  <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                  <svg className="w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                </div>
                                <div className="text-center px-4">
                                  <p className="mb-2 text-base text-slate-700 font-semibold">
                                    Click để chọn file (Excel, PDF, Ảnh)
                                  </p>
                                  <p className="text-sm text-slate-500">
                                    Hoặc nhấn <strong>Ctrl+V</strong> để dán ảnh chụp màn hình
                                  </p>
                                </div>
                               </>
                            )}
                        </div>
                        <input 
                          ref={fileInputRef}
                          type="file" 
                          accept=".xlsx, .xls, .pdf, image/*" 
                          className="hidden" 
                          onChange={handleFileUpload}
                          disabled={isExtracting}
                        />
                     </label>
                  </div>
            </div>
            
            {errorMsg && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-3">
                <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {errorMsg}
              </div>
            )}
          </section>
        )}

        {/* Data Table Area */}
        {students.length > 0 && (
           <section className="flex-1 min-h-[500px] flex flex-col animate-fade-in-up">
              <StudentList 
                students={students} 
                role={role} 
                subjectName={subjectName}
                onUpdateStudent={updateStudent} 
                onRegenerateSingle={handleRegenerateSingle}
                onRegenerateAll={() => handleRegenerateAll()}
                onChangeSubject={(subj) => handleRegenerateAll(subj)}
                isGenerating={isGenerating}
              />
           </section>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-slate-400">
            Trợ lý Nhận xét Học bạ | © 2026 – Nguyễn Chí Dũng
            <br className="sm:hidden" />
            <span className="hidden sm:inline mx-1">|</span>
            THCS Đoàn Bảo Đức | GDPT 2018 & TT22
          </p>
        </div>
      </footer>

      {/* Key Modal */}
      {showKeyModal && <ApiKeyModal onSave={handleSaveKey} />}

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
           <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative overflow-hidden">
              
              {/* Decorative Header Background */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-blue-400"></div>

              <div className="flex justify-between items-start mb-4">
                 <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <span className="text-2xl">ℹ️</span> Giới thiệu
                 </h3>
                 <button 
                   onClick={() => setShowAbout(false)}
                   className="text-slate-400 hover:text-slate-600 transition-colors p-1"
                 >
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="space-y-4 text-slate-600 text-sm leading-relaxed">
                 <p className="font-medium text-slate-700">
                   Ứng dụng được xây dựng nhằm hỗ trợ giáo viên THCS trong việc viết nhận xét học bạ theo 
                   <span className="text-primary font-semibold"> Thông tư 22/2021/TT-BGDĐT</span> và 
                   <span className="text-primary font-semibold"> Chương trình GDPT 2018</span>.
                 </p>

                 <p>
                   Ứng dụng phi lợi nhuận, được xây dựng từ nhu cầu thực tế của giáo viên.
                 </p>

                 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-start gap-2">
                       <span className="text-slate-400 mt-0.5">👤</span>
                       <div>
                          <strong className="block text-slate-800">Tác giả:</strong>
                          <a 
                            href="https://www.facebook.com/ncdung2013" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-slate-700 hover:text-primary hover:underline transition-colors"
                          >
                            Nguyễn Chí Dũng
                          </a>
                       </div>
                    </div>
                    <div className="flex items-start gap-2">
                       <span className="text-slate-400 mt-0.5">🏫</span>
                       <div>
                          <strong className="block text-slate-800">Đơn vị:</strong>
                          <span>THCS Đoàn Bảo Đức – Long Kiến – An Giang</span>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="mt-6 text-center">
                 <button 
                   onClick={() => setShowAbout(false)}
                   className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors"
                 >
                   Đóng
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

export default App;