const supabase = require('./src/db/supabase');

async function testConnection() {
    try {
        const { data, error, count } = await supabase
            .from('opportunities')
            .select('*', { count: 'exact' });

        if (error) {
            console.log('❌ Erreur :', error.message);
        } else {
            console.log(`✅ Connexion réussie. ${data.length} lignes trouvées (Total: ${count}).`);
            if (data.length > 0) {
                console.log('Sample data:', data[0]);
            }
        }
    } catch (err) {
        console.error('❌ Erreur critique:', err.message);
    }
}

testConnection();
