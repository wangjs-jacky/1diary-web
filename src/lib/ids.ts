import { v7 as uuidv7 } from 'uuid';

export const newId = () => uuidv7();

const DEVICE_KEY = '1diary.device-id';

export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = newId();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}
