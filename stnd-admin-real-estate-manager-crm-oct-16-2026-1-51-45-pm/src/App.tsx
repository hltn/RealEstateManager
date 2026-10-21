import React, { useState } from 'react';
import {
  INITIAL_CUSTOMERS,
  INITIAL_CARE_LOGS,
  INITIAL_APPOINTMENTS,
  INITIAL_DAILY_TASKS,
  INITIAL_GALLERY_IMAGES
} from './data/mockData';
import { Customer, CareLog, Appointment, DailyTask } from './types/crm';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { CustomerListView } from './components/CustomerListView';
import { CustomerDetailView } from './components/CustomerDetailView';
import { EditPersonaView } from './components/EditPersonaView';
import { EditInvestmentView } from './components/EditInvestmentView';
import { CreateCustomerView } from './components/CreateCustomerView';
import { CreateAppointmentView } from './components/CreateAppointmentView';
import { DailyTasksView } from './components/DailyTasksView';
import { AppointmentsView } from './components/AppointmentsView';
import { ReportsView } from './components/ReportsView';
import { ProjectsView } from './components/ProjectsView';
import { AIConfigView } from './components/AIConfigView';
import { LightboxModal } from './components/LightboxModal';
import { CallModal } from './components/CallModal';
import { ZaloModal } from './components/ZaloModal';
import { QuickNoteModal } from './components/QuickNoteModal';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('customers');
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('CUST-001');
  const [careLogs, setCareLogs] = useState<CareLog[]>(INITIAL_CARE_LOGS);
  const [appointments, setAppointments] = useState<Appointment[]>(INITIAL_APPOINTMENTS);
  const [tasks, setTasks] = useState<DailyTask[]>(INITIAL_DAILY_TASKS);

  // Modals state
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const [callModalCustomer, setCallModalCustomer] = useState<Customer | null>(null);
  const [zaloModalCustomer, setZaloModalCustomer] = useState<Customer | null>(null);
  const [quickNoteCustomer, setQuickNoteCustomer] = useState<Customer | null>(null);

  // Sidebar toggle state (desktop & mobile)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Selected customer object
  const currentCustomer =
    customers.find((c) => c.id === selectedCustomerId) || customers[0];

  // Filter care logs for current customer
  const currentCareLogs = careLogs.filter(
    (log) => log.customerId === currentCustomer.id
  );

  // Handlers
  const handleSelectCustomer = (cust: Customer) => {
    setSelectedCustomerId(cust.id);
    setCurrentView('customer_detail');
  };

  const handleSelectCustomerByName = (name: string) => {
    const found = customers.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (found) {
      setSelectedCustomerId(found.id);
      setCurrentView('customer_detail');
    }
  };

  const handleUpdateCustomer = (updated: Customer) => {
    setCustomers(customers.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleAddCustomer = (newCust: Customer) => {
    setCustomers([newCust, ...customers]);
    setSelectedCustomerId(newCust.id);
    setCurrentView('customer_detail');
  };

  const handleAddCareLog = (newLog: Omit<CareLog, 'id'>) => {
    const log: CareLog = {
      ...newLog,
      id: `LOG-${Date.now().toString().slice(-4)}`
    };
    setCareLogs([log, ...careLogs]);
  };

  const handleAddAppointment = (newApt: Appointment) => {
    setAppointments([newApt, ...appointments]);

    // Also push a task into DailyTasks
    const newTask: DailyTask = {
      id: `TASK-${Date.now().toString().slice(-4)}`,
      customerId: newApt.customerId,
      customerName: newApt.customerName,
      customerPhone: newApt.customerPhone,
      statusTag: 'Khách net',
      projectName: newApt.projectName,
      category: 'today',
      timeText: newApt.time,
      content: `${newApt.purpose}: ${newApt.details}`,
      aiSuggestion: 'Đã thiết lập gửi thiệp Zalo ZNS và nhắc hẹn tự động.',
      assignee: newApt.leadStaffName
    };
    setTasks([newTask, ...tasks]);
    setCurrentView('calendar');
  };

  const handleSaveQuickNote = (customerId: string, noteContent: string) => {
    const target = customers.find((c) => c.id === customerId);
    if (!target) return;

    const log: CareLog = {
      id: `LOG-${Date.now().toString().slice(-4)}`,
      customerId: target.id,
      author: 'Hạnh ★ (Chính)',
      authorRole: 'Trưởng nhóm kinh doanh',
      date:
        new Date().toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit'
        }) +
        ' ' +
        new Date().toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit'
        }),
      content: noteContent,
      tag: 'Ghi chú nhanh'
    };
    setCareLogs([log, ...careLogs]);
    alert(`Đã ghi nhận tương tác cho ${target.name}!`);
  };

  return (
    <div className="h-full flex overflow-hidden font-sans text-gray-800 bg-surface-container-low antialiased">
      {/* 1. Left Sidebar (Collapsible 284px) */}
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => setCurrentView(view)}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
      />

      {/* 2. Main Content Canvas */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Topbar (76px) */}
        <TopHeader
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onNavigate={(view) => setCurrentView(view)}
          customerCount={customers.length}
        />

        {/* Scrollable Work Area */}
        <main className="flex-1 overflow-y-auto px-6 lg:px-8 py-6 space-y-6 custom-scrollbar bg-surface-container-low">
          {/* VIEW: Customer List (Screen 11) */}
          {currentView === 'customers' && (
            <CustomerListView
              customers={customers}
              onSelectCustomer={handleSelectCustomer}
              onOpenCall={(c) => setCallModalCustomer(c)}
              onOpenZalo={(c) => setZaloModalCustomer(c)}
              onOpenQuickNote={(c) => setQuickNoteCustomer(c)}
              onNavigate={(v) => setCurrentView(v)}
            />
          )}

          {/* VIEW: Customer Detail (Screen 1, 2, 3) */}
          {currentView === 'customer_detail' && (
            <CustomerDetailView
              customer={currentCustomer}
              careLogs={currentCareLogs}
              onAddCareLog={handleAddCareLog}
              onUpdateCustomer={handleUpdateCustomer}
              onNavigate={(v) => setCurrentView(v)}
              onOpenCall={(c) => setCallModalCustomer(c)}
              onOpenZalo={(c) => setZaloModalCustomer(c)}
              onOpenLightbox={(idx) => {
                setLightboxIndex(idx);
                setIsLightboxOpen(true);
              }}
            />
          )}

          {/* VIEW: Edit Persona (Screen 4) */}
          {currentView === 'edit_persona' && (
            <EditPersonaView
              customer={currentCustomer}
              onSave={(updated) => {
                handleUpdateCustomer(updated);
                setCurrentView('customer_detail');
              }}
              onCancel={() => setCurrentView('customer_detail')}
            />
          )}

          {/* VIEW: Edit Investment (Screen 6) */}
          {currentView === 'edit_investment' && (
            <EditInvestmentView
              customer={currentCustomer}
              onSave={(updated) => {
                handleUpdateCustomer(updated);
                setCurrentView('customer_detail');
              }}
              onCancel={() => setCurrentView('customer_detail')}
            />
          )}

          {/* VIEW: Create Customer (Screen 7) */}
          {currentView === 'create_customer' && (
            <CreateCustomerView
              existingPhones={customers.map((c) => c.phone)}
              onAddCustomer={handleAddCustomer}
              onCancel={() => setCurrentView('customers')}
            />
          )}

          {/* VIEW: Create Appointment (Screen 5) */}
          {currentView === 'create_appointment' && (
            <CreateAppointmentView
              customers={customers}
              onAddAppointment={handleAddAppointment}
              onCancel={() => setCurrentView('calendar')}
            />
          )}

          {/* VIEW: Daily Tasks / Việc hôm nay (Screen 10) */}
          {currentView === 'today' && (
            <DailyTasksView
              tasks={tasks}
              customers={customers}
              onSelectCustomerByName={handleSelectCustomerByName}
              onOpenCallByName={(name) => {
                const found = customers.find(
                  (c) => c.name.toLowerCase() === name.toLowerCase()
                );
                if (found) setCallModalCustomer(found);
              }}
              onOpenZaloByName={(name) => {
                const found = customers.find(
                  (c) => c.name.toLowerCase() === name.toLowerCase()
                );
                if (found) setZaloModalCustomer(found);
              }}
              onOpenQuickNoteByName={(name) => {
                const found = customers.find(
                  (c) => c.name.toLowerCase() === name.toLowerCase()
                );
                if (found) setQuickNoteCustomer(found);
              }}
              onNavigate={(v) => setCurrentView(v)}
            />
          )}

          {/* VIEW: Appointments Calendar (Screen 8) */}
          {currentView === 'calendar' && (
            <AppointmentsView
              appointments={appointments}
              customers={customers}
              onNavigate={(v) => setCurrentView(v)}
              onOpenCall={(c) => setCallModalCustomer(c)}
              onSelectCustomerByName={handleSelectCustomerByName}
            />
          )}

          {/* VIEW: Reports (Screen 9) */}
          {currentView === 'reports' && (
            <ReportsView onNavigate={(v) => setCurrentView(v)} />
          )}

          {/* VIEW: Projects */}
          {currentView === 'projects' && (
            <ProjectsView onNavigate={(v) => setCurrentView(v)} />
          )}

          {/* VIEW: AI Config */}
          {currentView === 'ai_config' && <AIConfigView />}

          {/* Generic fallback views for other sidebar links */}
          {[
            'articles',
            'manage_wp',
            'market_analysis',
            'sources',
            'cronjob',
            'account_management'
          ].includes(currentView) && (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-theme-xs max-w-2xl space-y-4">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-2xl">
                    {currentView === 'articles'
                      ? 'article'
                      : currentView === 'manage_wp'
                      ? 'language'
                      : currentView === 'market_analysis'
                      ? 'trending_up'
                      : currentView === 'sources'
                      ? 'folder_open'
                      : currentView === 'cronjob'
                      ? 'schedule'
                      : 'manage_accounts'}
                  </span>
                </span>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 capitalize">
                    {currentView.replace('_', ' ')}
                  </h2>
                  <p className="text-xs text-gray-500">
                    Phân hệ quản trị tích hợp trong nền tảng STND Real Estate
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed">
                Hệ thống dữ liệu đang được đồng bộ hóa với cơ sở dữ liệu CRM trực tiếp.
                Bạn có thể quay lại phân hệ Quản lý khách hàng để tiếp tục làm việc.
              </p>

              <div className="pt-2">
                <button
                  onClick={() => setCurrentView('customers')}
                  className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-xs font-semibold shadow-theme-xs flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">
                    arrow_back
                  </span>
                  Quay lại Quản lý khách hàng
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ======================================================== */}
      {/* GLOBAL MODALS                                            */}
      {/* ======================================================== */}

      {/* 1. Project Photos Lightbox */}
      <LightboxModal
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        images={INITIAL_GALLERY_IMAGES}
        currentIndex={lightboxIndex}
        onIndexChange={(idx) => setLightboxIndex(idx)}
      />

      {/* 2. Call Simulation Modal */}
      <CallModal
        isOpen={callModalCustomer !== null}
        onClose={() => setCallModalCustomer(null)}
        customerName={callModalCustomer?.name || ''}
        customerPhone={callModalCustomer?.phone || ''}
        projectName={callModalCustomer?.interestedProjects[0] || "Q'Terra"}
        onSaveLog={(note, outcome) => {
          if (callModalCustomer) {
            handleAddCareLog({
              customerId: callModalCustomer.id,
              author: 'Hạnh ★ (Chính)',
              authorRole: 'Trưởng nhóm kinh doanh',
              date:
                new Date().toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit'
                }) +
                ' ' +
                new Date().toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit'
                }),
              content: note,
              contactMethod: 'Điện thoại',
              callResult: outcome,
              tag: 'Cuộc gọi vừa xong'
            });
          }
        }}
      />

      {/* 3. Zalo Message Sender Modal */}
      <ZaloModal
        isOpen={zaloModalCustomer !== null}
        onClose={() => setZaloModalCustomer(null)}
        customerName={zaloModalCustomer?.name || ''}
        customerPhone={zaloModalCustomer?.phone || ''}
        projectName={zaloModalCustomer?.interestedProjects[0] || "Q'Terra"}
        onSentMessage={(msg) => {
          if (zaloModalCustomer) {
            handleAddCareLog({
              customerId: zaloModalCustomer.id,
              author: 'Hạnh ★ (Chính)',
              authorRole: 'Trưởng nhóm kinh doanh',
              date:
                new Date().toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit'
                }) +
                ' ' +
                new Date().toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit'
                }),
              content: `[Zalo ZNS đã gửi]: "${msg}"`,
              contactMethod: 'Nhắn Zalo',
              tag: 'Đã đọc tin'
            });
          }
        }}
      />

      {/* 4. Quick Note Modal */}
      <QuickNoteModal
        isOpen={quickNoteCustomer !== null}
        onClose={() => setQuickNoteCustomer(null)}
        customer={quickNoteCustomer}
        onSaveNote={handleSaveQuickNote}
      />
    </div>
  );
}
