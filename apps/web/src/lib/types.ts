import type {
  AccessibilityFlag,
  AccessibilityNeed,
  AttendanceStatus,
  DisabilityType,
  Outcome,
  PermissionCode,
  QueueStatus,
  RiskLevel,
  Sex,
  TimelineEventType,
} from '@hospital/shared';

/** Tipos das respostas da API (espelham os DTOs dos serviços). */

export interface Me {
  user: {
    id: string;
    username: string;
    fullName: string;
    email: string | null;
    professionalRegister: string | null;
    sector: { code: string; name: string } | null;
    roles: { code: string; name: string }[];
    permissions: PermissionCode[];
    mustChangePassword: boolean;
  };
  session: { idleExpiresAt: string; absoluteExpiresAt: string; idleMinutes: number };
}

export interface Accessibility {
  flags: AccessibilityFlag[];
  effectiveFlags: AccessibilityFlag[];
  badges: { code: AccessibilityFlag; label: string }[];
  disabilityType: DisabilityType | null;
  needs: AccessibilityNeed[];
  otherNeedDescription: string | null;
  legalPriority: boolean;
}

export interface PatientBasic {
  id: string;
  recordNumber: string;
  fullName: string;
  socialName: string | null;
  displayName: string;
  birthDate: string;
  sex: Sex;
  ageYears: number;
  ageLabel: string;
}

export interface PatientSearchItem extends PatientBasic {
  cpfMasked: string | null;
  cnsMasked: string | null;
  phoneMasked: string | null;
  accessibility: Accessibility;
  activeAttendance: { id: string; code: string; status: AttendanceStatus } | null;
}

export interface PatientDetail extends PatientBasic {
  cpf: string | null;
  cns: string | null;
  rg: string | null;
  documentsMasked: boolean;
  nationality: string;
  birthplace: string | null;
  motherName: string | null;
  phones: { type: 'TELEFONE' | 'CELULAR'; number: string; isPrimary: boolean }[];
  address: { street: string | null; number: string | null; complement: string | null; neighborhood: string | null; city: string | null; state: string | null; zipCode: string | null } | null;
  guardian: { name: string; cpf: string | null; relationship: string; phone: string | null } | null;
  accessibility: Accessibility;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceListItem {
  id: string;
  code: string;
  ticket: string;
  status: AttendanceStatus;
  kind: string;
  reason: string | null;
  arrivedAt: string;
  finishedAt: string | null;
  riskLevel: RiskLevel | null;
  patient: PatientBasic;
  accessibility: Accessibility;
}

export interface AttendanceDetail extends Omit<AttendanceListItem, 'finishedAt'> {
  version: number;
  triageStartedAt: string | null;
  triageFinishedAt: string | null;
  firstCalledAt: string | null;
  consultationStartedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: string;
  room: string | null;
  doctor: string | null;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  label: string;
  category: 'GENERAL' | 'CLINICAL';
  occurredAt: string;
  actor: { name: string; register: string | null } | null;
  sector: string | null;
  detail: Record<string, unknown> | null;
  summary: string | null;
}

export interface Summary {
  date: string;
  attendancesToday: number;
  waitingTriage: number;
  inTriage: number;
  waitingDoctor: number;
  inConsultation: number;
  finishedToday: number;
  cancelledToday: number;
}

export interface TriageQueueItem {
  attendanceId: string;
  code: string;
  ticket: string;
  status: AttendanceStatus;
  queueStatus: QueueStatus;
  arrivedAt: string;
  waitingMinutes: number;
  reason: string | null;
  riskLevel: RiskLevel | null;
  patient: PatientBasic;
  accessibility: Accessibility;
  assignedTo: { id: string; name: string; isMe: boolean } | null;
  startedAt: string | null;
}

export interface Vitals {
  id: string;
  measuredAt: string;
  recordedBy: string | null;
  bloodPressure: string | null;
  systolic: number | null;
  diastolic: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  glucose: number | null;
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  painScale: number | null;
}

export interface Classification {
  id: string;
  level: RiskLevel;
  label?: string;
  previousLevel: RiskLevel | null;
  protocol?: string | null;
  observation: string | null;
  reason: string | null;
  classifiedBy: string;
  classifiedByRegister?: string | null;
  classifiedAt: string;
}

export interface TriageView {
  attendance: { id: string; code: string; ticket: string; status: AttendanceStatus; kind: string; reason: string | null; arrivedAt: string; version: number };
  patient: PatientBasic;
  accessibility: Accessibility;
  queue: { status: QueueStatus; assignedTo: { id: string; name: string } | null; isMine: boolean } | null;
  triage: {
    id: string;
    status: 'IN_PROGRESS' | 'FINISHED';
    chiefComplaint: string | null;
    symptoms: string | null;
    symptomOnset: string | null;
    allergies: string | null;
    medicationsInUse: string | null;
    notes: string | null;
    version: number;
    startedBy: string;
    startedAt: string;
    finishedBy: string | null;
    finishedAt: string | null;
  } | null;
  suggestedChiefComplaint: string | null;
  vitals: Vitals[];
  classifications: Classification[];
  currentRiskLevel: RiskLevel | null;
  protocolName: string;
  permissions: {
    canEdit: boolean;
    canCorrect: boolean;
    canAddVitals: boolean;
    canClassify: boolean;
    canFinish: boolean;
    canRelease: boolean;
    canStart: boolean;
    canEditAccessibility: boolean;
  };
}

export interface MedicalQueueItem {
  attendanceId: string;
  code: string;
  ticket: string;
  status: AttendanceStatus;
  queueStatus: QueueStatus;
  position: number | null;
  riskLevel: RiskLevel;
  enqueuedAt: string;
  waitingMinutes: number;
  maxWaitMinutes: number;
  overdue: boolean;
  chiefComplaint: string | null;
  patient: PatientBasic;
  accessibility: Accessibility;
  room: string | null;
  assignedTo: { id: string; name: string; isMe: boolean } | null;
  calledAt: string | null;
  callCount: number;
}

export interface MedicalQueue {
  waiting: MedicalQueueItem[];
  mine: MedicalQueueItem | null;
  inService: MedicalQueueItem[];
}

export interface Room {
  id: string;
  name: string;
  isActive: boolean;
  sector: { id: string; name: string };
  occupiedBy: string | null;
}

export interface CallResult {
  attendanceId: string;
  ticket: string;
  code: string;
  room: string;
  calledAt: string;
  recall: boolean;
}

export interface MedicalView {
  attendance: { id: string; code: string; ticket: string; status: AttendanceStatus; kind: string; reason: string | null; arrivedAt: string; triageFinishedAt: string | null; consultationStartedAt: string | null; finishedAt: string | null };
  patient: PatientBasic & { motherName: string | null; cpf: string | null; cns: string | null };
  accessibility: Accessibility;
  triage: { chiefComplaint: string | null; symptoms: string | null; symptomOnset: string | null; allergies: string | null; medicationsInUse: string | null; notes: string | null; finishedBy: string | null; finishedByRegister: string | null; finishedAt: string | null } | null;
  latestVitals: Vitals | null;
  vitals: Vitals[];
  risk: { level: RiskLevel; label: string; classifiedBy: string; classifiedByRegister: string | null; classifiedAt: string; protocol: string | null; observation: string | null } | null;
  classifications: Classification[];
  queue: { status: QueueStatus; room: { id: string; name: string } | null; assignedTo: { id: string; name: string } | null; isMine: boolean; calledAt: string | null; callCount: number } | null;
  consultation: {
    id: string;
    status: 'IN_PROGRESS' | 'FINISHED';
    doctor: { id: string; name: string; register: string | null };
    chiefComplaint: string | null;
    history: string | null;
    examination: string | null;
    conduct: string | null;
    outcome: Outcome | null;
    outcomeLabel: string | null;
    finalNotes: string | null;
    version: number;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  diagnoses: { id: string; code: string | null; description: string; isPrimary: boolean; createdBy: string; createdAt: string; removed: boolean; removedAt: string | null; removalReason: string | null }[];
  prescriptionItems: { id: string; position: number; medication: string; dose: string; route: string; frequency: string; duration: string; notes: string | null; createdBy: string; createdAt: string; canceled: boolean; canceledAt: string | null; cancelReason: string | null }[];
  notes: { id: string; type: 'COMPLEMENTO' | 'CORRECAO'; content: string; author: string; createdAt: string }[];
  versions: { id: string; recordType: 'TRIAGEM' | 'CONSULTA'; version: number; changedBy: string; changeReason: string | null; createdAt: string }[];
  timeline: TimelineEvent[];
  previousAttendances: number;
  permissions: {
    canStart: boolean;
    canRecall: boolean;
    canRelease: boolean;
    canEdit: boolean;
    canPrescribe: boolean;
    canFinish: boolean;
    canReclassify: boolean;
    canCorrect: boolean;
    canAddNote: boolean;
    canViewHistory: boolean;
    canCancel: boolean;
  };
}

export interface HistoryItem {
  id: string;
  code: string;
  arrivedAt: string;
  finishedAt: string | null;
  riskLevel: RiskLevel | null;
  chiefComplaint: string | null;
  allergies: string | null;
  doctor: string | null;
  outcome: Outcome | null;
  outcomeLabel: string | null;
  conduct: string | null;
  diagnoses: { code: string | null; description: string; isPrimary: boolean }[];
  medications: { medication: string; dose: string; route: string; frequency: string; duration: string }[];
}

export interface NotificationsResponse {
  items: { id: string; type: string; title: string; message: string; attendanceCode: string | null; createdAt: string; unread: boolean }[];
  unread: number;
}

export interface PublicSettings {
  hospitalName: string;
  protocolName: string;
  maxWaitMinutes: Record<RiskLevel, number>;
  legalPriorityTiebreak: boolean;
  idleMinutes: number;
}
