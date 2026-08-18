import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

export default function Modal({
  isOpen = true,
  onClose,
  children,
  className = '',
  contentStyle = {},
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  ariaLabel = 'Dialog'
}) {
  const [isClosing, setIsClosing] = useState(false);
  const modalRef = useRef(null);
  const previousActiveElementRef = useRef(null);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [isClosing, onClose]);

  // 1. Focus capture on open & restore on close + body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    previousActiveElementRef.current = document.activeElement;

    // Body scroll lock
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the modal content container or its first interactive element
    if (modalRef.current) {
      const focusable = modalRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        modalRef.current.focus();
      }
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  // 2. Keyboard handling (Escape to close & Tab trap)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      // Escape key handler
      if (e.key === 'Escape' && closeOnEscape) {
        e.preventDefault();
        handleClose();
        return;
      }

      // Tab trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = Array.from(
          modalRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          // Shift + Tab: if on first element, wrap to last
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: if on last element, wrap to first
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`modal-backdrop ${isClosing ? 'modal-backdrop-closing' : ''}`}
      onClick={() => {
        if (closeOnBackdropClick) handleClose();
      }}
      role="presentation"
    >
      <div
        ref={modalRef}
        className={`modal-container ${className} ${isClosing ? 'modal-container-closing' : ''}`}
        style={contentStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {showCloseButton && (
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Close dialog"
          >
            <X size={22} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
