const fs = require('fs');
let content = fs.readFileSync('Frontend/src/components/Dashboard.tsx', 'utf-8');

// 1. Inject db import
if (!content.includes("import { db }")) {
    content = content.replace("import { useWebLLM } from '../hooks/useWebLLM';", "import { useWebLLM } from '../hooks/useWebLLM';\nimport { db } from '../db';");
}

const fetchUserRegex = /  useEffect\(\(\) => \{[\s\S]*?const fetchUser = async \(\) => \{[\s\S]*?(?=    fetchUser\(\);)/;

const newFetchUser = `  useEffect(() => {
    const fetchUser = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          // If no token, maybe we shouldn't force logout immediately if we are offline, 
          // but if there's no token, we can't even authenticate offline.
          onLogout();
          return;
        }

        const res = await fetch(\`\${API_URL}/users/me\`, {
          headers: {
            'Authorization': \`Bearer \${token}\`
          }
        });

        if (res.ok) {
          const data = await res.json();
          const p = {
            name: \`\${data.firstname || ''} \${data.middlename || ''} \${data.lastname || ''}\`.replace(/\\s+/g, ' ').trim() || 'Guest User',
            email: data.email || '',
            password: '',
            department: data.department || '',
            profilePicture: data.profile_picture_url || \`https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1\`
          };
          setProfile(p);
          
          db.profile.put({
            id: 1,
            email: p.email,
            first_name: p.name,
            department: p.department,
            profile_picture_url: p.profilePicture
          }).catch(console.error);

        } else {
          onLogout();
        }
      } catch (error) {
        console.error('Failed to fetch user, trying offline cache:', error);
        try {
          const cached = await db.profile.get(1);
          if (cached) {
            setProfile({
              name: cached.first_name || 'Guest User',
              email: cached.email || '',
              password: '',
              department: cached.department || '',
              profilePicture: cached.profile_picture_url || \`https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=cbd5e1\`
            });
          } else {
             // If completely failed and no cache
             onLogout();
          }
        } catch(e) {}
      }
    };
`;

if (fetchUserRegex.test(content)) {
    content = content.replace(fetchUserRegex, newFetchUser);
    console.log("Success fetchUser patched.");
} else {
    console.log("Failed to find fetchUser");
}

fs.writeFileSync('Frontend/src/components/Dashboard.tsx', content);
