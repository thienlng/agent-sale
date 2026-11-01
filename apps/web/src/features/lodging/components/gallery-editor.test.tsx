import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import { type GalleryPhoto, GalleryEditor, type GalleryUploadSlot } from './gallery-editor';

let upload: ((urls: string[]) => void) | undefined;
const slot: GalleryUploadSlot = ({ remaining, onUploaded }) => {
  upload = onUploaded;
  return <p>remaining {remaining}</p>;
};

function Harness({ initial = [] as GalleryPhoto[] }) {
  const [photos, setPhotos] = useState(initial);
  return (
    <>
      <GalleryEditor value={photos} onChange={setPhotos} renderUpload={slot} showErrors />
      <output data-testid="value">{JSON.stringify(photos)}</output>
    </>
  );
}
const photos = () => JSON.parse(screen.getByTestId('value').textContent ?? '[]') as GalleryPhoto[];

describe('GalleryEditor', () => {
  it('adds uploaded photos with an empty caption and asks for the caption', () => {
    render(<Harness />);
    expect(screen.getByText('remaining 30')).toBeInTheDocument();
    act(() => upload?.(['https://s3.test/1.jpg', 'https://s3.test/2.jpg']));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getAllByText('Nhập chú thích cho ảnh này.')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Chú thích ảnh 1'), { target: { value: 'Hồ bơi' } });
    expect(photos().map((p) => p.caption)).toEqual(['Hồ bơi', '']);
    fireEvent.click(screen.getByRole('button', { name: 'Đưa ảnh 2 lên' }));
    expect(photos().map((p) => p.url)).toEqual(['https://s3.test/2.jpg', 'https://s3.test/1.jpg']);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá ảnh 1' }));
    expect(photos()).toHaveLength(1);
  });

  it('keeps a caption typed while an upload is running', () => {
    render(<Harness initial={[{ url: 'https://a.test/1.jpg', caption: '' }]} />);
    const finish = upload;
    fireEvent.change(screen.getByLabelText('Chú thích ảnh 1'), { target: { value: 'Pool' } });
    act(() => finish?.(['https://s3.test/new.jpg']));
    expect(photos().map((p) => p.caption)).toEqual(['Pool', '']);
  });
});
