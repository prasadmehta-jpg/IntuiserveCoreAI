import { useRouter } from 'next/router';

const ROLES = [
  { path: '/manager', label: '📊 Manager'  },
  { path: '/server',  label: '🪑 Server'   },
  { path: '/kitchen', label: '🍳 Kitchen'  },
  { path: '/bar',     label: '🍸 Bar'      },
  { path: '/staff',   label: '👆 Staff'    },
  { path: '/revenue', label: '💰 Revenue'  },
  { path: '/owner',   label: '👤 Owner'    },
  { path: '/cameras', label: '📷 Cameras'  },
  { path: '/pos',     label: '🔌 POS'      },
  { path: '/setup',   label: '⚙️  Setup'   },
  { path: '/demo',    label: '🎮 Demo'     },
];

export function RoleSwitcher() {
  const router = useRouter();
  return (
    <select
      value={router.pathname}
      onChange={e => router.push(e.target.value)}
      style={{ width: 'auto', padding: '6px 12px', fontSize: '13px' }}
    >
      {ROLES.map(r => (
        <option key={r.path} value={r.path}>{r.label}</option>
      ))}
    </select>
  );
}
