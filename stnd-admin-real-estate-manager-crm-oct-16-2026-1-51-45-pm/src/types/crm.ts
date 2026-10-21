export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  idNumber: string; // CCCD
  isVip: boolean;
  vipTier?: 'VIP' | 'VIP Platinum' | 'VIP Diamond';
  status: 'Có quan tâm' | 'Khách net' | 'Chưa tiếp cận' | 'Bỏ / Không nhu cầu';
  progressPercentage: number;
  progressStep: string;
  currentResidence: string;
  hometown: string;
  birthDate: string;
  maritalStatus: string;
  children: string;
  occupation: string;
  businessField: string;
  decisionMaker: 'Vợ chồng cùng duyệt' | 'Khách tự quyết' | 'Tham khảo gia đình';
  lifestyleTags: string[];
  freeTimeSlot: string;
  preferredContactMethod: 'Zalo' | 'Điện thoại' | 'Gặp mặt';
  preferredSalutation: string;
  staffLead: string;
  staffSupport: string[];
  teamGroup: string;
  interestedProjects: string[];
  budgetMin: number;
  budgetMax: number;
  equityRatio: string;
  loanIncentive: boolean;
  propertyType: string;
  bedroomType: string;
  purchasePurposes: string[];
  criteriaPriorities: string[];
  searchArea: string;
  specificLocation: string;
  leadSource: string;
  targetPurchaseTime: string;
  notes: string;
  c4Criteria: {
    demand: { achieved: boolean; text: string; percent: number };
    motivation: { achieved: boolean; text: string; percent: number };
    finance: { achieved: boolean; text: string; percent: number };
    timing: { achieved: boolean; text: string; percent: number };
  };
  nextAppointmentDate?: string;
  nextAppointmentTime?: string;
  nextAppointmentNote?: string;
}

export interface CareLog {
  id: string;
  customerId: string;
  author: string;
  authorRole: string;
  date: string;
  content: string;
  contactMethod?: string;
  callResult?: string;
  tag?: string;
  images?: {
    src: string;
    caption: string;
  }[];
}

export interface Appointment {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerStatus: string;
  projectName: string;
  purpose: 'Xem nhà mẫu' | 'Ký cọc / Hợp đồng' | 'Gặp tư vấn / Pháp lý' | 'Nhắc gọi tư vấn';
  date: string;
  time: string;
  location: string;
  details: string;
  leadStaff: string;
  leadStaffName: string;
  supportStaff: string;
  reminderBefore: string;
  smsZnsAuto: boolean;
  calendarSync: boolean;
  isCompleted: boolean;
  unitCode?: string;
  unitPrice?: string;
}

export interface DailyTask {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  statusTag: 'Có quan tâm' | 'Khách net';
  projectName: string;
  category: 'overdue' | 'today' | 'upcoming';
  overdueText?: string;
  timeText?: string;
  dateText?: string;
  content: string;
  aiSuggestion?: string;
  assignee: string;
}

export interface StaffPerformance {
  rank: number;
  name: string;
  role: string;
  avatarText: string;
  avatarBg: string;
  customersHandled: number;
  hotLeads: number;
  appointmentsCompleted: number;
  salesOrDeposits: string;
  projectName: string;
  kpiRate: number;
}
