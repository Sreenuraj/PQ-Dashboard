/**
 * Sidebar Component
 * Manages the collapsible, pin/unpin, and drag-resizable sidebar states.
 */

export function initSidebar() {
  const wrapper = document.getElementById('sidebar-wrapper');
  const sidebar = document.getElementById('sidebar');
  const pinBtn = document.getElementById('sidebar-pin-btn');
  const handle = document.getElementById('sidebar-resize-handle');

  if (!wrapper || !sidebar || !pinBtn || !handle) {
    console.warn('Sidebar DOM elements not found.');
    return;
  }

  // Load initial state from localStorage
  let isPinned = localStorage.getItem('sidebar-pinned') !== 'false'; // default true
  let savedWidth = localStorage.getItem('sidebar-width') || '228px';

  // Apply initial state
  applyPinnedState(isPinned);
  applyWidth(savedWidth);

  // Bind Pin/Unpin Toggle
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isPinned = !isPinned;
    applyPinnedState(isPinned);
  });

  // Bind Drag-to-Resize behavior
  handle.addEventListener('mousedown', (mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    handle.classList.add('resizing');

    const onMouseMove = (mouseMoveEvent) => {
      let currentWidth = mouseMoveEvent.clientX;

      // Handle collapse trigger via dragging
      if (currentWidth < 140) {
        if (isPinned) {
          isPinned = false;
          applyPinnedState(false);
        }
        return;
      }

      // Clamp between 180px and 400px
      if (currentWidth < 180) currentWidth = 180;
      if (currentWidth > 400) currentWidth = 400;

      const widthStr = `${currentWidth}px`;
      applyWidth(widthStr);
      localStorage.setItem('sidebar-width', widthStr);
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      handle.classList.remove('resizing');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  // Helper to apply pinned state classes and icons
  function applyPinnedState(pinned) {
    if (pinned) {
      wrapper.classList.remove('unpinned');
      wrapper.classList.add('pinned');
      pinBtn.title = 'Collapse Sidebar';
      // Adjust wrapper width to use the expanded width variables
      const widthVal = localStorage.getItem('sidebar-width') || '228px';
      applyWidth(widthVal);
    } else {
      wrapper.classList.remove('pinned');
      wrapper.classList.add('unpinned');
      pinBtn.title = 'Pin Sidebar';
      wrapper.style.setProperty('--sidebar-w', '64px');
    }
    localStorage.setItem('sidebar-pinned', pinned ? 'true' : 'false');
  }

  // Helper to apply sidebar width CSS variables
  function applyWidth(width) {
    wrapper.style.setProperty('--expanded-sidebar-w', width);
    if (isPinned) {
      wrapper.style.setProperty('--sidebar-w', width);
    }
  }
}
