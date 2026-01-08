import { GoogleGenAI, Type, Schema } from "@google/genai";
import { StudentData, TeacherRole } from "../types";

// --- CẤU HÌNH API KEY ---
const getStoredKey = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('GEMINI_API_KEY') || "";
  }
  return "";
};

const getAIClient = () => {
  let apiKey = getStoredKey();

  if (!apiKey) {
    apiKey = process.env.API_KEY || "";
  }
  
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
  }

  return new GoogleGenAI({ apiKey });
};

// CHUYỂN SANG BẢN ỔN ĐỊNH (STABLE) ĐỂ KHẮC PHỤC LỖI QUOTA CỦA BẢN EXP
// gemini-2.0-flash là bản mới nhất, nhanh và hạn ngạch cao.
const MODEL_NAME = "gemini-2.0-flash";

/**
 * Test API Connection
 */
export const testApiConnection = async (apiKey: string): Promise<boolean> => {
  try {
    const ai = new GoogleGenAI({ apiKey });
    // Gọi một lệnh siêu nhẹ để test mạng và key
    await ai.models.generateContent({
      model: MODEL_NAME,
      contents: "Hello",
    });
    return true;
  } catch (e) {
    console.error("Test connection failed:", e);
    throw e;
  }
};

/**
 * Helper to normalize subject name from AI output to App's convention
 */
const normalizeSubjectName = (rawName?: string): string | undefined => {
  if (!rawName) return undefined;
  const s = rawName.toLowerCase();
  
  if (s.includes('toán')) return 'Toán';
  if (s.includes('văn') || s.includes('việt') || s.includes('ngữ')) return 'Văn';
  if (s.includes('ls') || s.includes('lịch sử') || s.includes('địa')) return 'LS & ĐL';
  if (s.includes('khtn') || s.includes('khoa học tự nhiên') || s.includes('lý') || s.includes('hóa') || s.includes('sinh') || s.includes('vật')) return 'KHTN';
  if (s.includes('tin')) return 'Tin học';
  if (s.includes('anh') || s.includes('ngoại ngữ')) return 'Ng.ngữ';
  if (s.includes('gdcd') || s.includes('công dân')) return 'GDCD';
  if (s.includes('công nghệ') || s.includes('c.nghệ')) return 'C.nghệ';
  if (s.includes('thể') || s.includes('gdtc')) return 'GDTC';
  if (s.includes('nhạc') || s.includes('mỹ thuật') || s.includes('nghệ thuật')) return 'Nghệ thuật';
  if (s.includes('địa phương') || s.includes('ndgdcđp')) return 'NDGDCĐP';
  if (s.includes('trải nghiệm') || s.includes('hướng nghiệp') || s.includes('hđtn')) return 'HĐTN&HN';
  
  return undefined;
};

/**
 * Extracts student data from an Image or PDF using Gemini Vision capabilities.
 */
export const extractDataFromMedia = async (
  base64Data: string,
  mimeType: string,
  role: TeacherRole
): Promise<{ students: StudentData[], detectedSubject?: string }> => {
  
  const ai = getAIClient(); 

  const prompt = role === TeacherRole.SUBJECT 
    ? `Bạn là trợ lý nhập liệu. Hãy phân tích hình ảnh/PDF bảng điểm này:
       1. TÌM TÊN MÔN HỌC: Đọc kỹ tiêu đề bảng (ví dụ: "MÔN TIẾNG ANH", "Hóa học", "Toán"...).
       2. TRÍCH XUẤT DANH SÁCH HỌC SINH:
       - Cột họ tên: Lấy đầy đủ họ và tên. Gộp họ và tên nếu tách rời.
       - Cột điểm: Tìm cột điểm tổng kết cuối cùng (thường ghi là ĐTB, ĐTBmhk, TBM, hoặc cột điểm số cuối cùng bên phải). Trả về dạng số.
       - Cột xếp loại: Tìm cột xếp loại hoặc Đ/CĐ.
       - Chỉ lấy các dòng chứa thông tin học sinh. Bỏ qua dòng tiêu đề và footer.`
    : `Bạn là trợ lý nhập liệu. Hãy trích xuất bảng tổng kết từ hình ảnh/PDF này.
       - Họ tên: Lấy đầy đủ.
       - Kết quả học tập (KQHT): Tốt/Khá/Đạt/Chưa đạt (hoặc T/K/Đ/CĐ/TB/Y/Kém).
       - Kết quả rèn luyện (KQRL): Tốt/Khá/Đạt/Chưa đạt (hoặc T/K/Đ/CĐ).
       - Số ngày nghỉ: Số buổi nghỉ học.`;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      subjectName: { type: Type.STRING, nullable: true, description: "Tên môn học tìm thấy trong ảnh (ví dụ: Tiếng Anh, Toán...)" },
      students: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Họ và tên học sinh" },
            score: { type: Type.NUMBER, nullable: true, description: "Điểm trung bình (số)" },
            rating: { type: Type.STRING, nullable: true, description: "Xếp loại (chữ)" },
            kqht: { type: Type.STRING, nullable: true, description: "Kết quả học tập" },
            kqrl: { type: Type.STRING, nullable: true, description: "Kết quả rèn luyện" },
            absences: { type: Type.NUMBER, nullable: true, description: "Số buổi nghỉ" }
          },
          required: ["name"]
        }
      }
    },
    required: ["students"]
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME, 
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const resultText = response.text;
    if (!resultText) return { students: [] };

    let rawData;
    try {
      rawData = JSON.parse(resultText);
    } catch (e) {
      const clean = resultText.replace(/```json/g, '').replace(/```/g, '');
      rawData = JSON.parse(clean);
    }
    
    // Check structure (Object with students array)
    const studentsList = rawData.students || (Array.isArray(rawData) ? rawData : []);
    const rawSubject = rawData.subjectName;

    const students = studentsList.map((item: any, idx: number) => ({
      id: `student-img-${Date.now()}-${idx}`,
      name: item.name || `Học sinh ${idx + 1}`,
      subjectScore: item.score,
      subjectRating: item.rating,
      academicResult: item.kqht,
      conductRating: item.kqrl,
      absences: item.absences,
      comment: '',
      isProcessing: false
    }));

    return { 
      students, 
      detectedSubject: normalizeSubjectName(rawSubject) 
    };

  } catch (error: any) {
    if (error.message === "MISSING_API_KEY") throw error;
    console.error("Error extracting data from media:", error);
    throw new Error(error.message || "Không thể xử lý file. Hãy đảm bảo ảnh/PDF rõ nét và chứa bảng điểm.");
  }
};

/**
 * Helper to get subject-specific vocabulary
 */
const getSubjectCharacteristics = (subject: string): string => {
    const s = subject.toLowerCase();
    if (s.includes('toán')) return 'Tập trung vào tư duy logic, kỹ năng tính toán, khả năng vận dụng công thức và giải bài tập.';
    if (s.includes('văn') || s.includes('việt')) return 'Tập trung vào khả năng diễn đạt, dùng từ, cảm thụ văn học, chữ viết và chính tả.';
    if (s.includes('ng.ngữ') || s.includes('ngoại ngữ') || s.includes('anh')) return 'Tập trung vào từ vựng, ngữ pháp, kỹ năng nghe-nói-đọc-viết, sự tự tin khi giao tiếp.';
    if (s.includes('khtn') || s.includes('khoa học tự nhiên')) return 'Tập trung vào kiến thức tổng hợp Vật lý, Hóa học, Sinh học và tư duy khoa học thực nghiệm.';
    if (s.includes('ls & đl') || (s.includes('lịch sử') && s.includes('địa'))) return 'Tập trung vào kiến thức lịch sử, địa lý, sự kiện, mốc thời gian và kỹ năng đọc bản đồ.';
    if (s.includes('lý') || s.includes('vật lí')) return 'Tập trung vào tư duy vật lý, khả năng giải thích hiện tượng, thực hành thí nghiệm.';
    if (s.includes('hóa')) return 'Tập trung vào kiến thức phương trình, tính chất hóa học, thao tác thí nghiệm.';
    if (s.includes('sinh')) return 'Tập trung vào kiến thức sinh học, thế giới tự nhiên, bảo vệ môi trường.';
    if (s.includes('sử')) return 'Tập trung vào khả năng ghi nhớ sự kiện, tư duy lịch sử, liên hệ thực tế.';
    if (s.includes('địa')) return 'Tập trung vào kỹ năng đọc bản đồ, kiến thức địa lý tự nhiên/kinh tế xã hội.';
    if (s.includes('gdcd') || s.includes('công dân')) return 'Tập trung vào ý thức đạo đức, ứng xử, hiểu biết pháp luật và kỹ năng sống.';
    if (s.includes('tin')) return 'Tập trung vào thao tác máy tính, tư duy lập trình, soạn thảo văn bản.';
    if (s.includes('c.nghệ') || s.includes('công nghệ')) return 'Tập trung vào kỹ năng kỹ thuật, thiết kế, áp dụng kiến thức vào đời sống.';
    if (s.includes('thể') || s.includes('gdtc')) return 'Tập trung vào thể lực, kỹ thuật động tác, tinh thần rèn luyện sức khỏe.';
    if (s.includes('nhạc') || s.includes('mỹ thuật') || s.includes('nghệ thuật')) return 'Tập trung vào năng khiếu, khả năng thẩm mỹ, sự sáng tạo và hoàn thành sản phẩm.';
    if (s.includes('hđtn') || s.includes('trải nghiệm') || s.includes('hướng nghiệp')) return 'Tập trung vào sự tham gia hoạt động tập thể, kỹ năng giải quyết vấn đề và định hướng tương lai.';
    if (s.includes('ndgdcđp') || s.includes('địa phương')) return 'Tập trung vào sự hiểu biết về văn hóa, lịch sử, kinh tế đặc trưng của địa phương.';
    return 'Tập trung vào thái độ học tập, sự chăm chỉ, mức độ hoàn thành nhiệm vụ môn học.';
};

/**
 * Generates comments for a batch of students.
 */
export const generateCommentsBatch = async (
  students: StudentData[],
  role: TeacherRole,
  subjectName: string = "Môn học"
): Promise<Map<string, string>> => {
  
  if (students.length === 0) return new Map();

  const ai = getAIClient();

  let logicRules = "";
  let roleInstruction = "";
  const wordLimit = role === TeacherRole.SUBJECT ? 12 : 20;

  if (role === TeacherRole.SUBJECT) {
      const characteristics = getSubjectCharacteristics(subjectName);
      roleInstruction = `Bạn là Giáo viên bộ môn dạy môn ${subjectName}.`;
      logicRules = `
        ĐẶC THÙ BỘ MÔN: ${characteristics}
        
        QUY TẮC NHẬN XÉT (Kết hợp điểm số và đặc thù môn):
        - Cực kỳ ngắn gọn, súc tích (TỐI ĐA ${wordLimit} CHỮ).
        - Điểm Giỏi (>= 8.0) hoặc Đạt Tốt: Khen ngợi năng lực đặc thù của môn, xác nhận nắm vững kiến thức. (Ví dụ: "Học tốt, nắm chắc kiến thức trọng tâm.")
        - Điểm Khá (6.5 - 7.9): Ghi nhận sự cố gắng, nhưng cần cẩn thận hoặc phát huy thêm. (Ví dụ: "Có cố gắng, cần cẩn thận hơn khi làm bài.")
        - Điểm Trung bình (5.0 - 6.4) hoặc Đạt: Cần chăm chỉ hơn, chú ý bài giảng. (Ví dụ: "Cần tập trung nghe giảng và làm bài tập nhiều hơn.")
        - Điểm Yếu/Kém (< 5.0) hoặc Chưa đạt (CĐ): Nhắc nhở việc học lại kiến thức cơ bản. (Ví dụ: "Chưa đạt chuẩn, cần ôn lại kiến thức cơ bản.")
      `;
  } else {
      roleInstruction = `Bạn là Giáo viên chủ nhiệm lớp.`;
      logicRules = `
        QUY TẮC NHẬN XÉT TỔNG HỢP (Theo Thông tư 22, TỐI ĐA ${wordLimit} CHỮ):
        Phân tích sự tương quan giữa KQHT, KQRL và số ngày nghỉ:
        
        1. Nhóm Tốt/Toàn diện: Khen ngợi ngoan ngoãn, gương mẫu, học giỏi.
        2. Nhóm Khá: Ghi nhận ý thức phấn đấu, rèn luyện tốt.
        3. Nhóm Cần cố gắng: Khuyên cần chú ý cải thiện môn học yếu hoặc thái độ.
        4. Nhóm Chuyên cần: Nhắc nhở nếu nghỉ nhiều.
        
        Viết một câu nhận xét tổng quát bao hàm cả học lực và hạnh kiểm.
      `;
  }

  const systemInstruction = `
    ${roleInstruction}
    Nhiệm vụ: Viết nhận xét ngắn gọn cho học bạ.
    Yêu cầu BẮT BUỘC:
    - Độ dài: KHÔNG QUÁ ${wordLimit} từ.
    - Văn phong sư phạm, động viên, tích cực.
    - KHÔNG phán xét nặng nề.
    ${logicRules}
  `;

  const outputSchema: Schema = {
    type: Type.ARRAY,
    items: {
       type: Type.OBJECT,
       properties: {
          id: { type: Type.STRING },
          comment: { type: Type.STRING }
       },
       required: ["id", "comment"]
    }
  };

  const studentPayload = students.map(s => {
    if (role === TeacherRole.SUBJECT) {
      return {
        id: s.id,
        name: s.name,
        score: s.subjectScore !== undefined ? s.subjectScore : s.subjectRating
      };
    } else {
      return {
        id: s.id,
        name: s.name,
        kqht: s.academicResult,
        kqrl: s.conductRating,
        absences: s.absences
      };
    }
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: JSON.stringify(studentPayload),
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: outputSchema,
      },
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");

    let parsedResults;
    try {
        parsedResults = JSON.parse(resultText);
    } catch {
        return new Map();
    }
    
    const commentMap = new Map<string, string>();
    if (Array.isArray(parsedResults)) {
        parsedResults.forEach((item: any) => {
          if (item && item.id && item.comment) {
             commentMap.set(item.id, item.comment);
          }
        });
    }

    return commentMap;

  } catch (error: any) {
    if (error.message === "MISSING_API_KEY") throw error;
    console.error("Error generating comments:", error);
    throw error;
  }
};