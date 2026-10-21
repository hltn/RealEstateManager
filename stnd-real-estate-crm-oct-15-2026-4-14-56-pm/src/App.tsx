import { useState, useEffect } from 'react';
import { MainTab, Customer, Appointment, FilterOptions } from './types';
import { INITIAL_CUSTOMERS, INITIAL_APPOINTMENTS } from './data/mockData';
import { TopAppBar } from './components/TopAppBar';
import { BottomNavBar } from './components/BottomNavBar';
import { SideDrawer } from './components/SideDrawer';
import { QuickNoteModal } from './components/QuickNoteModal';
import { LightboxModal, GalleryPhoto } from './components/LightboxModal';
import { Toast, ToastMessage } from './components/Toast';

import { TodayTasksView } from './views/TodayTasksView';
import { CustomerListView } from './views/CustomerListView';
import { AppointmentsView } from './views/AppointmentsView';
import { ReportsView } from './views/ReportsView';
import { CustomerDetailView } from './views/CustomerDetailView';
import { AddClientView } from './views/AddClientView';
import { CreateAppointmentView } from './views/CreateAppointmentView';
import { EditPersonaView } from './views/EditPersonaView';
import { EditInvestmentView } from './views/EditInvestmentView';
import { AdvancedFilterModal } from './views/AdvancedFilterModal';

type ActiveView =
  | 'tab'
  | 'customer-detail'
  | 'add-client'
  | 'create-appointment'
  | 'edit-persona'
  | 'edit-investment';

export default function App() {
  // Main Tab Navigation
  const [currentTab, setCurrentTab] = useState<MainTab>('customers');
  const [activeView, setActiveView] = useState<ActiveView>('tab');

  // Database state (persisted to localStorage)
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('stnd_customers');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_CUSTOMERS;
      }
    }
    return INITIAL_CUSTOMERS;
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem('stnd_appointments');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_APPOINTMENTS;
      }
    }
    return INITIAL_APPOINTMENTS;
  });

  // Selected customer for detail / edit
  const [selectedCustomer, setSelectedCustomer] = useState<Customer>(
    INITIAL_CUSTOMERS[0]
  );

  // Filters State
  const [filters, setFilters] = useState<FilterOptions>({
    search: '',
    status: 'caring',
    project: 'all',
    projectsSelected: ["Q'Terra", 'The Privia'],
    staff: 'all',
    timeRange: 'month',
  });

  // Modal states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [quickNoteCustomer, setQuickNoteCustomer] = useState<Customer | null>(null);

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<GalleryPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (title: string, message?: string, type: 'success' | 'info' | 'warning' = 'success') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Sync state to local storage
  useEffect(() => {
    localStorage.setItem('stnd_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('stnd_appointments', JSON.stringify(appointments));
  }, [appointments]);

  // Actions
  const handleSelectCustomer = (cust: Customer) => {
    setSelectedCustomer(cust);
    setActiveView('customer-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCall = (phone: string, name: string) => {
    addToast(`Đang gọi đến ${name}`, `SĐT: ${phone}`, 'info');
    // Open tel protocol if available
    window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  };

  const handleZalo = (phone: string, name: string) => {
    addToast(`Mở đoạn chat Zalo`, `Đang kết nối đến Zalo của khách hàng ${name}...`, 'success');
  };

  const handleSaveQuickNote = (
    customerId: string,
    noteContent: string,
    statusText: string,
    reminderDate: string
  ) => {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === customerId) {
          const newLog = {
            id: `log-${Date.now()}`,
            date: 'Hôm nay',
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            isLatest: true,
            author: '★ Hạnh (Chính)',
            content: `${statusText}: ${noteContent}. (${reminderDate})`,
          };
          return {
            ...c,
            notesSummary: noteContent,
            timelineLogs: [newLog, ...(c.timelineLogs || [])],
          };
        }
        return c;
      })
    );
    addToast('Đã lưu nhật ký ghi chú thành công!', undefined, 'success');
  };

  const handleAddTimelineLog = (customerId: string, logContent: string) => {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === customerId) {
          const newLog = {
            id: `log-${Date.now()}`,
            date: 'Hôm nay',
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            isLatest: true,
            author: '★ Hạnh (Chính)',
            content: logContent,
          };
          const updatedLogs = [newLog, ...(c.timelineLogs || [])];
          return {
            ...c,
            timelineLogs: updatedLogs,
          };
        }
        return c;
      })
    );
    addToast('Đã thêm nhật ký chăm sóc mới!', undefined, 'success');
  };

  const handleSaveNewClient = (newClient: Customer) => {
    setCustomers([newClient, ...customers]);
    addToast('Thêm khách hàng thành công!', `${newClient.name} đã được thêm vào hệ thống.`);
    setSelectedCustomer(newClient);
    setActiveView('customer-detail');
  };

  const handleSaveNewAppointment = (newAppt: Appointment) => {
    setAppointments([newAppt, ...appointments]);
    addToast('Tạo lịch hẹn thành công!', `${newAppt.title} đã được lưu.`);
    setActiveView('tab');
    setCurrentTab('appointments');
  };

  const handleUpdatePersona = (updatedFields: Partial<Customer>) => {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === selectedCustomer.id) {
          const updated = { ...c, ...updatedFields };
          setSelectedCustomer(updated);
          return updated;
        }
        return c;
      })
    );
    addToast('Cập nhật Chân dung khách hàng thành công!');
    setActiveView('customer-detail');
  };

  const handleUpdateInvestment = (updatedInvestment: any) => {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === selectedCustomer.id) {
          const updated = {
            ...c,
            project: updatedInvestment.projects[0] || c.project,
            investmentInfo: updatedInvestment,
          };
          setSelectedCustomer(updated);
          return updated;
        }
        return c;
      })
    );
    addToast('Cập nhật Thông tin đầu tư thành công!');
    setActiveView('customer-detail');
  };

  const handleResetData = () => {
    setCustomers(INITIAL_CUSTOMERS);
    setAppointments(INITIAL_APPOINTMENTS);
    setSelectedCustomer(INITIAL_CUSTOMERS[0]);
    localStorage.removeItem('stnd_customers');
    localStorage.removeItem('stnd_appointments');
    addToast('Đã khôi phục dữ liệu mẫu ban đầu!', undefined, 'info');
  };

  const handleOpenLightbox = (photos: GalleryPhoto[], startIndex: number) => {
    setLightboxPhotos(photos);
    setLightboxIndex(startIndex);
    setLightboxOpen(true);
  };

  const handleToggleCompleteAppointment = (id: string) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isCompleted: !a.isCompleted } : a))
    );
    addToast('Đã cập nhật trạng thái lịch hẹn!');
  };

  const handleExport = () => {
    addToast('Đang xuất báo cáo STND...', 'File Excel/PDF đang được tạo tải xuống.', 'info');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-between items-center text-gray-900 font-body-md antialiased selection:bg-brand-100 selection:text-brand-900">
      {/* Toast Notification Container */}
      <Toast toasts={toasts} onDismiss={removeToast} />

      {/* Side Navigation Drawer */}
      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setActiveView('tab');
        }}
        onOpenAddClient={() => setActiveView('add-client')}
        onOpenCreateAppointment={() => setActiveView('create-appointment')}
        onOpenAdvancedFilter={() => setIsFilterModalOpen(true)}
      />

      {/* Advanced Filter Modal (Screen 5) */}
      <AdvancedFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        filters={filters}
        onApplyFilters={(newFilters) => {
          setFilters(newFilters);
          addToast('Đã áp dụng bộ lọc nâng cao!');
        }}
        onResetFilters={() => {
          setFilters({
            ...filters,
            projectsSelected: [],
            timeRange: 'month',
            staff: 'all',
          });
          addToast('Đã đặt lại bộ lọc mặc định');
        }}
      />

      {/* Quick Note Modal */}
      <QuickNoteModal
        isOpen={quickNoteCustomer !== null}
        customer={quickNoteCustomer}
        onClose={() => setQuickNoteCustomer(null)}
        onSaveNote={handleSaveQuickNote}
      />

      {/* Full Photo Lightbox Modal (Screen 7 gallery) */}
      <LightboxModal
        isOpen={lightboxOpen}
        photos={lightboxPhotos}
        currentIndex={lightboxIndex}
        onClose={() => setLightboxOpen(false)}
        onSelectIndex={setLightboxIndex}
      />

      {/* Main View Container Constrained for authentic mobile & tablet experience */}
      <div className="w-full max-w-md min-h-screen bg-gray-50 flex flex-col relative shadow-theme-md border-x border-gray-200">
        {/* Render View Modes */}
        {activeView === 'tab' && (
          <>
            <TopAppBar
              onOpenMenu={() => setIsDrawerOpen(true)}
              onResetData={handleResetData}
            />

            {currentTab === 'today' && (
              <TodayTasksView
                customers={customers}
                onSelectCustomer={handleSelectCustomer}
                onOpenAddClient={() => setActiveView('add-client')}
                onOpenQuickNote={(c) => setQuickNoteCustomer(c)}
                onCall={handleCall}
                onZalo={handleZalo}
                onSelectTab={setCurrentTab}
              />
            )}

            {currentTab === 'customers' && (
              <CustomerListView
                customers={customers}
                onSelectCustomer={handleSelectCustomer}
                onOpenAddClient={() => setActiveView('add-client')}
                onOpenAdvancedFilter={() => setIsFilterModalOpen(true)}
                onOpenQuickNote={(c) => setQuickNoteCustomer(c)}
                onCall={handleCall}
                onZalo={handleZalo}
                onSelectTab={setCurrentTab}
                filters={filters}
                onUpdateSearch={(search) => setFilters({ ...filters, search })}
              />
            )}

            {currentTab === 'appointments' && (
              <AppointmentsView
                appointments={appointments}
                customers={customers}
                onOpenCreateAppointment={() => setActiveView('create-appointment')}
                onSelectCustomer={handleSelectCustomer}
                onCall={handleCall}
                onSelectTab={setCurrentTab}
                onToggleCompleteAppointment={handleToggleCompleteAppointment}
              />
            )}

            {currentTab === 'reports' && (
              <ReportsView
                onOpenAdvancedFilter={() => setIsFilterModalOpen(true)}
                onExport={handleExport}
                onSelectTab={setCurrentTab}
              />
            )}

            {/* Bottom Navigation Bar */}
            <BottomNavBar
              currentTab={currentTab}
              onSelectTab={setCurrentTab}
              todayCount={7}
            />
          </>
        )}

        {/* SCREEN 7: Chi tiết khách hàng */}
        {activeView === 'customer-detail' && (
          <CustomerDetailView
            customer={selectedCustomer}
            onBack={() => setActiveView('tab')}
            onEditPersona={() => setActiveView('edit-persona')}
            onEditInvestment={() => setActiveView('edit-investment')}
            onCall={handleCall}
            onZalo={handleZalo}
            onOpenLightbox={handleOpenLightbox}
            onAddTimelineLog={handleAddTimelineLog}
          />
        )}

        {/* SCREEN 9: Thêm khách hàng mới */}
        {activeView === 'add-client' && (
          <AddClientView
            onBack={() => setActiveView('tab')}
            onSaveClient={handleSaveNewClient}
            existingCustomers={customers}
          />
        )}

        {/* SCREEN 4: Tạo lịch hẹn mới */}
        {activeView === 'create-appointment' && (
          <CreateAppointmentView
            customers={customers}
            onBack={() => setActiveView('tab')}
            onSaveAppointment={handleSaveNewAppointment}
          />
        )}

        {/* SCREEN 8: Cập nhật Chân dung khách hàng */}
        {activeView === 'edit-persona' && (
          <EditPersonaView
            customer={selectedCustomer}
            onBack={() => setActiveView('customer-detail')}
            onSave={handleUpdatePersona}
          />
        )}

        {/* SCREEN 10: Cập nhật Thông tin đầu tư */}
        {activeView === 'edit-investment' && (
          <EditInvestmentView
            customer={selectedCustomer}
            onBack={() => setActiveView('customer-detail')}
            onSave={handleUpdateInvestment}
          />
        )}
      </div>
    </div>
  );
}
