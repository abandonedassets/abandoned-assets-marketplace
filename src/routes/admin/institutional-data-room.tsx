import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/admin/institutional-data-room')({
  component: AdminInstitutionalDataRoomRedirect,
});

function AdminInstitutionalDataRoomRedirect() {
  useEffect(() => {
    // Client-side redirect to the authenticated data room route
    window.location.replace('/_authenticated/admin/institutional-data-room');
  }, []);

  return null;
}
