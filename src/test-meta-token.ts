const token = 'EAAOAMdpOiPYBSNCqIN97Jh2uVxX5lhoR66vRPzyXn2Kf6Qhl6Mkg8octff0sFk6A5641eilLSn5d7WsZAvQgVCXWTDl01EPBSKL8D0FIJp84yixGWisqnbZAokguS0b8OhlGrXKYk3bLzEjgYqER3U26CJ9dkYhOKTiy6ZAsw4o9Q4JIDHGxnsBUo231sJd3AZDZD';

async function inspectMetaToken() {
  console.log('🔍 Inspecting Meta System User permissions...\n');

  try {
    const permRes = await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${token}`);
    const permData = await permRes.json();
    console.log('🔑 Permissions Granted:', JSON.stringify(permData, null, 2));

    const debugRes = await fetch(`https://graph.facebook.com/v20.0/debug_token?input_token=${token}&access_token=${token}`);
    const debugData = await debugRes.json();
    console.log('🛡️ Debug Token Info:', JSON.stringify(debugData, null, 2));
  } catch (err: any) {
    console.error('❌ Error inspecting token:', err.message);
  }
}

inspectMetaToken();
