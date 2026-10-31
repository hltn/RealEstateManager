import { z } from 'zod';

/**
 * Rule field tài khoản dùng chung cho form tạo và form sửa — đồng bộ với DTO backend (mục 16.4).
 * Tách riêng để rule mật khẩu/tên/email chỉ khai báo 1 chỗ (DRY).
 */
export const emailSchema = z
  .string()
  .min(1, 'Vui lòng nhập email')
  .email('Email không đúng định dạng');

export const passwordSchema = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Tên hiển thị tối thiểu 2 ký tự')
  .max(50, 'Tên hiển thị tối đa 50 ký tự');
