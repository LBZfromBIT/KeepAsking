export interface FileAttachment {
  name: string;
  text: string;
}

export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 200_000;

export function decodeTextFile(name: string, bytes: Uint8Array): FileAttachment {
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`文件过大（超过 200 KB）：${name}`);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) throw new Error(`不能读取二进制文件：${name}`);
  }
  return { name, text: new TextDecoder().decode(bytes) };
}
