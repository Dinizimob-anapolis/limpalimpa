// Mapa de "número → nome real" — sobrescreve o nome que aparece no perfil do WhatsApp
// da pessoa, que às vezes é um apelido, nome de outra pessoa, ou até um símbolo estranho.
// Cobre funcionárias (STAFF_NUMBERS) e alguns clientes específicos que já geraram confusão.
// Formato da chave: só dígitos, sem @s.whatsapp.net (aceita variação com/sem o "9" extra).
const CONTACT_NAMES = {
  // Funcionárias
  '556294028048': 'Maria Ribeiro',
  '5562994028048': 'Maria Ribeiro',
  '556282691455': 'Julia',
  '5562982691455': 'Julia',
  '557999552178': 'Clara',
  '5579999552178': 'Clara',
  '556294632569': 'Joceline',
  '5562994632569': 'Joceline',
  '556294515306': 'Nova Havila',
  '5562994515306': 'Nova Havila',
  '556292794440': 'Eliane',
  '5562992794440': 'Eliane',
  '556291980368': 'Lucileide',
  '5562991980368': 'Lucileide',
  '556291991941': 'Jessana',
  '5562991991941': 'Jessana',
  '556295339369': 'Maria Aparecida',
  '5562995339369': 'Maria Aparecida',
  '557996316141': 'Simone (equipe)',
  '5579996316141': 'Simone (equipe)',
  '556295186964': 'Albertina',
  '5562995186964': 'Albertina',
  '556294801814': 'Marinete',
  '5562994801814': 'Marinete',
  '556295687425': 'Maria Dos Anjos',
  '5562995687425': 'Maria Dos Anjos',
  '556292092192': 'Sara',
  '5562992092192': 'Sara',
  '556294371779': 'Rafaela',
  '5562994371779': 'Rafaela',
  '556294518755': 'Marcia',
  '5562994518755': 'Marcia',
  '556293747897': 'Fernanda Fátima',
  '5562993747897': 'Fernanda Fátima',
  '556293624075': 'Lena',
  '5562993624075': 'Lena',
  '556292789341': 'Fernanda',
  '5562992789341': 'Fernanda',
  '556196402578': 'Michele',
  '5561996402578': 'Michele',
  '556293757328': 'Anizete',
  '5562993757328': 'Anizete',

  // Clientes que geraram confusão de nome (perfil do WhatsApp não bate com o nome real)
  '556295253994': 'Alaides',
  '556291567660': 'Simone (cliente)',
};

function realNameFor(remoteJid) {
  if (!remoteJid) return null;
  const phone = remoteJid.split('@')[0];
  return CONTACT_NAMES[phone] || null;
}

module.exports = { CONTACT_NAMES, realNameFor };
