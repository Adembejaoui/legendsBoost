/**
 * FAQ shown under the order form (client PDFs 2026-11-19: Rank Boost and
 * Arena). Plain text: edit the questions and answers here, keep each answer
 * short. A page shows its FAQ when its key ("game:service") is listed below;
 * add more pages the same way.
 *
 * Answers describe how the site really works (completion with screenshots
 * and customer confirmation, pause at any time, encrypted login, admin-
 * reviewed refunds). Keep them true if the process changes.
 */
export interface FaqItem {
  question: string
  answer: string
}

export const faqAC: Record<string, FaqItem[]> = {
  'league-of-legends:rank-boost': [
    {
      question: 'How does a Rank Boost work?',
      answer:
        'Choose your current and desired rank, your server and the extras you want, then pay. A verified booster takes your order and plays until your desired rank is reached. In Solo the booster plays on your account; in Duo you play together with the booster.',
    },
    {
      question: 'How long does it take?',
      answer:
        'It depends on how many divisions you buy and your LP gains. Most orders start within an hour of payment. Priority Order moves yours ahead of standard orders. Your booster posts your current rank after every session, so you can follow the progress on your order page.',
    },
    {
      question: 'Is my account safe?',
      answer:
        'Your login is encrypted and only your booster can see it, during a play session, and every view is logged. You can add VPN and Appear Offline for free. Boosting is against Riot Games\' rules, so no service can promise zero risk, but our boosters play carefully to keep it low.',
    },
    {
      question: 'Can I play on my account during the boost?',
      answer:
        'Yes. Pause the order from your order page whenever you want to play, then resume it when you are done. Please do not play ranked games while your booster has a session running.',
    },
    {
      question: 'What if I am not happy with the result?',
      answer:
        'When your booster finishes, you get screenshots of the final rank. Confirm the result, or report a problem and our team will review it. You can also request a cancellation; approved requests are refunded for the part that was not done.',
    },
  ],
  'league-of-legends:arena-boost': [
    {
      question: 'What is an Arena Boost?',
      answer:
        'You choose how many Arena wins you want (1 to 5) and your server. A booster wins those games for you on your account (Solo), or plays them together with you (Duo).',
    },
    {
      question: 'How long does an Arena Boost take?',
      answer:
        'Arena games are short, so most orders are done within a few hours of the booster starting. Priority moves your order ahead of standard orders.',
    },
    {
      question: 'Can I choose the champions?',
      answer:
        'Yes. In Solo, Specific Champion and Role is free, and OTP Champ Only makes the booster play one champion of your choice. In Duo, Your Champions and Roles lets you pick them.',
    },
    {
      question: 'Is my account safe during an Arena Boost?',
      answer:
        'Your login is encrypted and only visible to your booster during a session. VPN and Appear Offline are free in Solo. As with any boosting service, Riot Games\' rules apply and no one can promise zero risk.',
    },
    {
      question: 'What happens when the wins are done?',
      answer:
        'Your booster completes the order with screenshots. You confirm the result or report a problem to our team. Without an answer, the order confirms automatically after 72 hours.',
    },
  ],
}

export function faqFor(gameSlug: string, serviceSlug: string): FaqItem[] {
  return faqAC[`${gameSlug}:${serviceSlug}`] ?? []
}
