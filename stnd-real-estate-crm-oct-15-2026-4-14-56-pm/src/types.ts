export type MainTab = 'today' | 'customers' | 'appointments' | 'reports';

export type LeadStatus = 'caring' | 'hot' | 'dropped';

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  idNumber?: string;
  status: LeadStatus;
  statusLabel: string;
  project: string;
  progressStep: number; // 1 to 4
  progressPercent: number; // 25, 50, 75, 100
  assignedLead: string;
  assignedMembers: string[];
  nextAppointmentDate: string;
  appointmentTime?: string;
  isVip?: boolean;
  notesSummary?: string;
  aiSuggestion?: string;
  category?: 'overdue' | 'today' | 'upcoming';
  overdueText?: string;
  
  // Persona (C10)
  birthday?: string;
  remindBirthday?: boolean;
  hometown?: string;
  currentResidence?: string;
  maritalStatus?: string;
  childrenCount?: string;
  career?: string;
  industry?: string;
  decisionMaker?: 'both' | 'self' | 'family';
  lifestyleTags?: string[];
  preferredChannel?: 'zalo' | 'phone' | 'meeting';
  freeTimeSlot?: string;
  preferredSalutation?: string;
  additionalNotes?: string;

  // Investment info
  investmentInfo?: {
    projects: string[];
    budgetMin: string;
    budgetMax: string;
    ownCapitalRatio: string;
    needsLoanSupport: boolean;
    propertyType: string;
    bedrooms: string;
    purposes: string[];
    priorityCriteria: string[];
    searchArea: string;
    specificLocation: string;
    source: string;
    targetTimeline: string;
  };

  // Deal criteria (C4)
  dealCriteria?: {
    demand: { met: boolean; text: string };
    motivation: { met: boolean; text: string };
    finance: { met: boolean; text: string };
    timeline: { met: boolean; text: string };
  };

  // Timeline interaction history
  timelineLogs?: Array<{
    id: string;
    date: string;
    time: string;
    isLatest?: boolean;
    author: string;
    content: string;
    photos?: string[];
    photoCaptions?: string[];
  }>;
}

export interface Appointment {
  id: string;
  title: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerTag?: string;
  time: string;
  date: string;
  dayOfWeek?: string;
  dayNumber?: number;
  period: 'morning' | 'afternoon';
  type: 'xem_nha' | 'ky_coc' | 'gap_truc_tiep' | 'nhac_goi' | 'khac';
  typeLabel: string;
  location: string;
  assignedLead: string;
  coWorker?: string;
  reminderTime?: string;
  isCompleted?: boolean;
  note?: string;
  autoSms?: boolean;
}

export interface FilterOptions {
  search: string;
  status: string; // 'all' | 'caring' | 'hot' | 'dropped'
  project: string; // 'all' or specific project name
  projectsSelected: string[];
  staff: string;
  timeRange: string; // 'week' | 'month' | 'quarter' | 'year'
}
