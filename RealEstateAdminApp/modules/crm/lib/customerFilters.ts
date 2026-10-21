import type { Customer, FilterOptions, StaffMember } from '@crm/types/crm';
import { toLeadStatus } from './customerAdapters';
import { isSameStaffName } from './staff';

const normalizeText = (value: string): string => value.trim().toLowerCase();
const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/**
 * Lọc danh sách khách theo FilterOptions (logic của Mobile CustomerListView, mở rộng):
 * trạng thái -> từ khoá (tên / SĐT / dự án / mã) -> dự án đơn -> nhiều dự án -> nhân viên.
 */
export const filterCustomers = (
  customers: Customer[],
  filters: FilterOptions,
  staffList: StaffMember[] = [],
): Customer[] => {
  const keyword = normalizeText(filters.search);
  const keywordDigits = digitsOnly(filters.search);
  const staffMember = staffList.find((staff) => staff.id === filters.staff);


  return customers.filter((customer) => {
    if (filters.status !== 'all' && toLeadStatus(customer.status) !== filters.status) return false;

    if (keyword) {
      const isNameMatch = normalizeText(customer.name).includes(keyword);
      const isPhoneMatch = keywordDigits.length > 0 && digitsOnly(customer.phone).includes(keywordDigits);
      const isProjectMatch = customer.interestedProjects.some((project) => normalizeText(project).includes(keyword));
      const isCodeMatch = normalizeText(customer.code).includes(keyword);
      if (!isNameMatch && !isPhoneMatch && !isProjectMatch && !isCodeMatch) return false;
    }

    if (filters.project !== 'all' && !customer.interestedProjects.includes(filters.project)) return false;

    if (
      filters.projectsSelected.length > 0 &&
      !customer.interestedProjects.some((project) => filters.projectsSelected.includes(project))
    ) {
      return false;
    }

    // `staffLead` lưu họ tên đầy đủ như `STAFF_LIST` -> so khớp nguyên tên.
    if (staffMember && !isSameStaffName(customer.staffLead, staffMember.name)) return false;

    return true;
  });
};
