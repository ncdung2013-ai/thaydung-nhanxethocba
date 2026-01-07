export enum TeacherRole {
  SUBJECT = 'GVBM',
  HOMEROOM = 'GVCN',
}

export enum AcademicRating {
  TOT = 'T',
  KHA = 'K',
  DAT = 'Đ',
  CHUADAT = 'CĐ',
}

export interface StudentData {
  id: string;
  name: string;
  // GVBM specific
  subjectScore?: number; // TBMHK
  subjectRating?: string; // Đ or CĐ (for artistic subjects etc.)
  
  // GVCN specific
  academicResult?: string; // KQHT (T/K/Đ/CĐ)
  conductRating?: string; // KQRL (T/K/Đ/CĐ)
  absences?: number;
  
  // Generated content
  comment: string;
  isProcessing: boolean;
}

export interface GenerateRequest {
  students: StudentData[];
  role: TeacherRole;
  subjectName?: string;
}

// For Excel parsing logic
export interface RawRow {
  [key: string]: string | number | undefined;
}