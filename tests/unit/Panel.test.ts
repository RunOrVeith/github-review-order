import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import Panel from '@/entrypoints/review-order.content/Panel.svelte';

// jsdom does no layout, so give the viewport a size
beforeEach(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
});

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

test('starts in the bottom-right corner', () => {
  renderPanel();

  const panel = screen.getByRole('complementary', { name: 'Review order' });
  expect(panel.style.left).toBe('984px');
  expect(panel.style.top).toBe('784px');
});

test('starts at the saved position', () => {
  const initialPosition = {
    horizontal: { edge: 'left', offset: 40 },
    vertical: { edge: 'top', offset: 60 },
  } as const;
  render(Panel, { items, initialIndex: 0, initialPosition, onNavigate: () => true, onClose: () => {} });

  const panel = screen.getByRole('complementary', { name: 'Review order' });
  expect(panel.style.left).toBe('40px');
  expect(panel.style.top).toBe('60px');
});

function renderDraggable() {
  const onMove = vi.fn();
  render(Panel, { items, initialIndex: 0, onNavigate: () => true, onMove, onClose: () => {} });
  return {
    onMove,
    panel: screen.getByRole('complementary', { name: 'Review order' }),
    handle: screen.getByRole('group', { name: 'Drag to move' }),
  };
}

test('can be dragged by its header', async () => {
  const { onMove, panel, handle } = renderDraggable();

  await fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(handle, { buttons: 1, clientX: 110, clientY: 60 });
  await fireEvent.pointerUp(handle);

  expect(panel.style.left).toBe('100px');
  expect(panel.style.top).toBe('50px');
  expect(onMove).toHaveBeenCalledExactlyOnceWith({
    horizontal: { edge: 'left', offset: 100 },
    vertical: { edge: 'top', offset: 50 },
  });
});

test('a click on the header does not save a position', async () => {
  const { onMove, handle } = renderDraggable();

  await fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerUp(handle);

  expect(onMove).not.toHaveBeenCalled();
});

test('stops dragging when pointer capture is lost', async () => {
  const { onMove, panel, handle } = renderDraggable();

  await fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(handle, { buttons: 1, clientX: 110, clientY: 60 });
  await fireEvent(handle, new Event('lostpointercapture'));
  await fireEvent.pointerMove(handle, { buttons: 1, clientX: 300, clientY: 300 });

  expect(panel.style.left).toBe('100px');
  expect(onMove).toHaveBeenCalledOnce();
});

test('stops dragging when the button was released elsewhere', async () => {
  const { onMove, panel, handle } = renderDraggable();

  await fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(handle, { buttons: 1, clientX: 110, clientY: 60 });
  await fireEvent.pointerMove(handle, { buttons: 0, clientX: 300, clientY: 300 });
  await fireEvent.pointerMove(handle, { buttons: 1, clientX: 400, clientY: 400 });

  expect(panel.style.left).toBe('100px');
  expect(onMove).toHaveBeenCalledOnce();
});

test('clicking the close button does not start a drag', async () => {
  const { onMove } = renderDraggable();
  const close = screen.getByRole('button', { name: 'Close' });

  await fireEvent.pointerDown(close, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(close, { buttons: 1, clientX: 110, clientY: 60 });
  await fireEvent.pointerUp(close);

  expect(onMove).not.toHaveBeenCalled();
});

describe('skip viewed', () => {
  const files = [
    { path: 'src/a.ts', description: 'first' },
    { path: 'src/b.ts', description: 'second' },
    { path: 'src/c.ts', description: 'third' },
    { path: 'src/d.ts', description: 'fourth' },
  ];

  function renderSkipping({ viewed = new Set<number>(), initialIndex = 0, initialSkipViewed = true } = {}) {
    let notify = () => {};
    const onNavigate = vi.fn(() => true);
    const onSkipViewedChange = vi.fn();
    render(Panel, {
      items: files,
      initialIndex,
      initialSkipViewed,
      isViewed: (index: number) => viewed.has(index),
      watchViewed: (onChange: () => void) => {
        notify = onChange;
        return () => {};
      },
      onNavigate,
      onSkipViewedChange,
      onClose: () => {},
    });
    return { onNavigate, onSkipViewedChange, notify: () => notify(), user: userEvent.setup() };
  }

  const button = (name: string) => screen.getByRole('button', { name });

  test('is on by default', () => {
    render(Panel, { items: files, initialIndex: 0, onNavigate: () => true, onClose: () => {} });
    expect(screen.getByRole('checkbox', { name: 'Skip viewed' })).toBeChecked();
  });

  test('Next and Previous jump over viewed files', async () => {
    const { onNavigate, user } = renderSkipping({ viewed: new Set([1, 2]) });

    await user.click(button('Next'));
    expect(onNavigate).toHaveBeenLastCalledWith(3);
    expect(screen.getByText('4 / 4')).toBeInTheDocument();

    await user.click(button('Previous'));
    expect(onNavigate).toHaveBeenLastCalledWith(0);
  });

  test('disables a button when only viewed files are left in its direction', () => {
    renderSkipping({ viewed: new Set([2, 3]), initialIndex: 1 });

    expect(button('Next')).toBeDisabled();
    expect(button('Next')).toHaveAttribute('title', 'All files after this one are viewed');
    expect(button('Previous')).toBeEnabled();
    expect(button('Previous')).not.toHaveAttribute('title');
  });

  test('Reset current stays on a viewed file', async () => {
    const { onNavigate, user } = renderSkipping({ viewed: new Set([1]), initialIndex: 1 });

    await user.click(button('Reset current'));
    expect(onNavigate).toHaveBeenLastCalledWith(1);
  });

  test('turning it off steps through viewed files again', async () => {
    const { onNavigate, onSkipViewedChange, user } = renderSkipping({ viewed: new Set([1, 2]) });

    await user.click(screen.getByRole('checkbox', { name: 'Skip viewed' }));
    expect(onSkipViewedChange).toHaveBeenCalledWith(false);

    await user.click(button('Next'));
    expect(onNavigate).toHaveBeenLastCalledWith(1);
  });

  test('starts off when it was turned off before', async () => {
    const { onNavigate, user } = renderSkipping({ viewed: new Set([1]), initialSkipViewed: false });

    expect(screen.getByRole('checkbox', { name: 'Skip viewed' })).not.toBeChecked();
    await user.click(button('Next'));
    expect(onNavigate).toHaveBeenLastCalledWith(1);
  });

  test('follows files being unticked on the page', async () => {
    const viewed = new Set([2, 3]);
    const { notify } = renderSkipping({ viewed, initialIndex: 1 });
    expect(button('Next')).toBeDisabled();

    viewed.delete(3);
    notify();
    await tick();

    expect(button('Next')).toBeEnabled();
  });
});
