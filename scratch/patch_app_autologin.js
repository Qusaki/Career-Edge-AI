const fs = require('fs');
let content = fs.readFileSync('Frontend/src/App.tsx', 'utf-8');

const regex = /  const \[currentView, setCurrentView\] = useState\<'landing' \| 'auth' \| 'dashboard'\>\('landing'\);/;

const replacement = `  const [currentView, setCurrentView] = useState<'landing' | 'auth' | 'dashboard'>('landing');

  useEffect(() => {
    // Auto-login if token exists
    if (localStorage.getItem('token')) {
      setCurrentView('dashboard');
    }
  }, []);`;

if (content.match(regex)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('Frontend/src/App.tsx', content);
    console.log("Success App.tsx auto-login patched.");
} else {
    console.log("Failed to find auto-login target in App.tsx");
}
