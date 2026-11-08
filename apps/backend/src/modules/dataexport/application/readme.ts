import type { ArchiveCounts } from './ports/export-files.js';

/**
 * `README.txt` of the export archive, in the requester's language (product copy, SET-10). Lists
 * every file with its row count; the per-column meaning is in the column headers.
 */
export function renderReadme(
  locale: 'vi' | 'en',
  input: { businessName: string; createdAt: Date; counts: ArchiveCounts; includeMedia: boolean },
): string {
  const files = Object.entries(input.counts.rows)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, rows]) => `  ${file.padEnd(36)} ${rows}`)
    .join('\r\n');
  const at = input.createdAt.toISOString().replace('T', ' ').slice(0, 16);
  if (locale === 'en') {
    return [
      `Rapiz data export: ${input.businessName}`,
      `Created ${at} UTC`,
      '',
      'Each .csv file is one kind of data (UTF-8, open with Excel or Google Sheets).',
      'Ids link the files together: e.g. customer_id in orders.csv is the id in customers.csv.',
      'Times are UTC (ISO 8601). Money is in VND, whole numbers.',
      'Text that starts like a spreadsheet formula is prefixed with an apostrophe.',
      'Not included: passwords, channel tokens, API keys and other secrets.',
      '',
      'Files and rows:',
      files,
      '',
      input.includeMedia
        ? `media/: ${input.counts.mediaFiles} pictures and files stored by Rapiz` +
          (input.counts.mediaSkipped
            ? `; ${input.counts.mediaSkipped} links kept only as links (outside Rapiz or gone).`
            : '.')
        : 'Pictures and files are not included (links stay in the CSV files).',
      '',
    ].join('\r\n');
  }
  return [
    `Dữ liệu xuất từ Rapiz: ${input.businessName}`,
    `Tạo lúc ${at} (giờ UTC)`,
    '',
    'Mỗi tệp .csv là một loại dữ liệu (UTF-8, mở bằng Excel hoặc Google Sheets).',
    'Các cột id nối các tệp với nhau: ví dụ customer_id trong orders.csv là id trong customers.csv.',
    'Thời gian theo giờ UTC (ISO 8601). Tiền tính bằng VND, số nguyên.',
    'Nội dung bắt đầu giống công thức bảng tính được thêm dấu nháy đơn ở đầu.',
    'Không bao gồm: mật khẩu, token kết nối kênh, API key và các thông tin bí mật khác.',
    '',
    'Danh sách tệp và số dòng:',
    files,
    '',
    input.includeMedia
      ? `media/: ${input.counts.mediaFiles} ảnh và tệp lưu trên Rapiz` +
        (input.counts.mediaSkipped
          ? `; ${input.counts.mediaSkipped} liên kết chỉ giữ dạng link (ngoài Rapiz hoặc đã bị xoá).`
          : '.')
      : 'Không kèm ảnh và tệp (các liên kết vẫn có trong tệp CSV).',
    '',
  ].join('\r\n');
}
