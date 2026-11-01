import { useState, type ComponentProps } from 'react';
import { maskIdNumber } from '@crm/lib/contact';
import { TextInput } from './TextInput';

type MaskedIdInputProps = Omit<ComponentProps<typeof TextInput>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Ô nhập CCCD: che số (chỉ hiện 4 số cuối, vd "•••• •••• 1234") khi không focus, hiện đầy đủ khi đang nhập/sửa.
 * Nguồn ghi "Mã hóa bảo mật" -> CCCD không lộ khi màn hình đang mở mà không thao tác.
 */
export const MaskedIdInput = ({ value, onValueChange, onFocus, onBlur, ...inputProps }: MaskedIdInputProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const shouldMask = !isEditing && value.length > 0;

  return (
    <TextInput
      {...inputProps}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={shouldMask ? maskIdNumber(value) : value}
      data-masked={shouldMask ? 'true' : 'false'}
      className={`font-mono tracking-wide ${inputProps.className ?? ''}`}
      onChange={(event) => onValueChange(event.target.value)}
      onFocus={(event) => {
        setIsEditing(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsEditing(false);
        onBlur?.(event);
      }}
    />
  );
};
