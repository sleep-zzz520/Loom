export const AVATAR_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';
export const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;

type AvatarUploadCandidate = Pick<File, 'size' | 'type'>;

export function avatarUploadError(file: AvatarUploadCandidate) {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return '请选择 JPG 或 PNG 图片。';
  if (!Number.isFinite(file.size) || file.size <= 0) return '图片文件为空，请重新选择。';
  if (file.size > MAX_AVATAR_FILE_SIZE) return '图片不能超过 5MB。';
  return null;
}
