import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import { imageUrlProblem, ProductImagesEditor } from './product-images-editor';

function Harness({ initial = [] as string[] }) {
  const [urls, setUrls] = useState(initial);
  return (
    <>
      <ProductImagesEditor value={urls} onChange={setUrls} />
      <output>{JSON.stringify(urls)}</output>
    </>
  );
}

const field = () => screen.getByLabelText(/image link|liên kết ảnh/i);
const urls = () => JSON.parse(screen.getByRole('status').textContent ?? '[]') as string[];

describe('imageUrlProblem', () => {
  it('accepts https, rejects other schemes, duplicates and a sixth image', () => {
    expect(imageUrlProblem('https://cdn.example.com/a.jpg', [])).toBeNull();
    expect(imageUrlProblem('http://cdn.example.com/a.jpg', [])).toBe('invalid');
    expect(imageUrlProblem('javascript:alert(1)', [])).toBe('invalid');
    expect(imageUrlProblem('https://a.example/x.jpg', ['https://a.example/x.jpg'])).toBe(
      'duplicate',
    );
    const five = Array.from({ length: 5 }, (_, i) => `https://a.example/${i}.jpg`);
    expect(imageUrlProblem('https://a.example/new.jpg', five)).toBe('limit');
  });
});

describe('ProductImagesEditor', () => {
  it('adds an https image with a thumbnail and removes it again', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: 'https://cdn.example.com/a.jpg' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(urls()).toEqual(['https://cdn.example.com/a.jpg']);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(field()).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /remove image 1|bỏ ảnh 1/i }));
    expect(urls()).toEqual([]);
  });

  it('shows an error and keeps the list for an http link', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: 'http://cdn.example.com/a.jpg' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(urls()).toEqual([]);
  });

  it('stops at five images', () => {
    const five = Array.from({ length: 5 }, (_, i) => `https://a.example/${i}.jpg`);
    render(<Harness initial={five} />);
    expect(field()).toBeDisabled();
  });
});
