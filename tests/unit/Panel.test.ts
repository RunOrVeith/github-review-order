import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import Panel from '@/entrypoints/review-order.content/Panel.svelte';

const items = [
  { path: 'src/a.ts', description: 'first' },
  { path: 'src/b.ts', description: 'second' },
  { path: 'src/c.ts', description: 'third' },
];

function renderPanel(initialIndex = 0, found = true) {
  const onNavigate = vi.fn(() => found);
  const onClose = vi.fn();
  render(Panel, { items, initialIndex, onNavigate, onClose });
  return { onNavigate, onClose, user: userEvent.setup() };
}

test('scrolls to the initial step on mount', () => {
  const { onNavigate } = renderPanel(1);

  expect(onNavigate).toHaveBeenCalledWith(1);
  expect(screen.getByText('2 / 3')).toBeInTheDocument();
  expect(screen.getByText('src/b.ts')).toBeInTheDocument();
  expect(screen.getByText('second')).toBeInTheDocument();
});

test('steps through the files', async () => {
  const { onNavigate, user } = renderPanel();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(onNavigate).toHaveBeenLastCalledWith(1);
  expect(screen.getByText('src/b.ts')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Previous' }));
  expect(onNavigate).toHaveBeenLastCalledWith(0);
  expect(screen.getByText('src/a.ts')).toBeInTheDocument();
});

test('reset scrolls back to the current file', async () => {
  const { onNavigate, user } = renderPanel(2);

  await user.click(screen.getByRole('button', { name: 'Reset current' }));
  expect(onNavigate).toHaveBeenLastCalledWith(2);
  expect(screen.getByText('3 / 3')).toBeInTheDocument();
});

test('disables the buttons at either end', async () => {
  const { user } = renderPanel();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

test('tells the user when the file is not in the PR', async () => {
  renderPanel(0, false);
  expect(await screen.findByText('File not found in this PR')).toBeInTheDocument();
});

test('closes', async () => {
  const { onClose, user } = renderPanel();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalled();
});

test('starts at the saved position', () => {
  const initialPosition = { x: 40, y: 60 };
  render(Panel, { items, initialIndex: 0, initialPosition, onNavigate: () => true, onClose: () => {} });

  const panel = screen.getByRole('complementary', { name: 'Review order' });
  expect(panel.style.left).toBe('40px');
  expect(panel.style.top).toBe('60px');
});

test('can be dragged by its header', async () => {
  const onMove = vi.fn();
  render(Panel, { items, initialIndex: 0, onNavigate: () => true, onMove, onClose: () => {} });
  const handle = screen.getByRole('group', { name: 'Drag to move' });

  await fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(handle, { clientX: 110, clientY: 60 });
  await fireEvent.pointerUp(handle);

  const panel = screen.getByRole('complementary', { name: 'Review order' });
  expect(panel.style.left).toBe('100px');
  expect(panel.style.top).toBe('50px');
  expect(onMove).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 50 });
});

test('clicking the close button does not start a drag', async () => {
  const onMove = vi.fn();
  render(Panel, { items, initialIndex: 0, onNavigate: () => true, onMove, onClose: () => {} });
  const close = screen.getByRole('button', { name: 'Close' });

  await fireEvent.pointerDown(close, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(close, { clientX: 110, clientY: 60 });
  await fireEvent.pointerUp(close);

  expect(onMove).not.toHaveBeenCalled();
});
