-- Script SQL pour configurer la table public.profiles dans Supabase

-- 1. Création de la table profiles si elle n'existe pas
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'freelance',
  
  -- Liens professionnels
  github_url TEXT,
  portfolio_url TEXT,
  linkedin_url TEXT,
  
  -- Contact téléphonique (séparation de l'indicatif pour faciliter son usage)
  phone_country_code TEXT, -- Ex: '+33' (France), '+261' (Madagascar)
  phone_number TEXT,       -- Le numéro sans l'indicatif
  
  -- Crédits disponibles sur la plateforme
  credits INTEGER DEFAULT 10,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activation de Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Ajout des politiques de sécurité
-- L'utilisateur peut consulter son propre profil
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT USING (auth.uid() = id);

-- L'utilisateur peut modifier son propre profil
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 4. Fonction et Trigger pour mettre à jour 'updated_at'
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Fonction et Trigger pour insérer automatiquement un profil lors de l'enregistrement via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, credits)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'freelance'),
    10 -- Crédits offerts à l'inscription
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
