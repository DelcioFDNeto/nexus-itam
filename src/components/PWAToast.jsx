import React, { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

const PWAToast = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        setInterval(() => {
          r.update();
        }, 60 * 60 * 1000); // Check every hour
      }
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  useEffect(() => {
    if (needRefresh) {
      toast('Nova versão disponível!', {
        description: 'Atualize a página para carregar as novidades.',
        duration: Infinity,
        icon: <RefreshCw className="animate-spin text-indigo-500" />,
        action: {
          label: 'Atualizar',
          onClick: () => updateServiceWorker(true),
        },
        onDismiss: () => setNeedRefresh(false)
      });
    }
  }, [needRefresh, updateServiceWorker, setNeedRefresh]);

  return null;
};

export default PWAToast;
