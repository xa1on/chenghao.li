import { buddies as buddiesList } from '../../buddies.js?v=72a3cbbf99';

export const buddies = {
  name: 'buddies',
  description: 'Display buddy box.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    if (!buddiesList || buddiesList.length === 0) return;

    let buddiesPerRow = 5;
    let borderLength = 60;

    if (window.innerWidth < 480) {
      buddiesPerRow = 2;
      borderLength = 24;
    } else if (window.innerWidth < 768) {
      buddiesPerRow = 3;
      borderLength = 34;
    }

    const rows = [];
    for (let i = 0; i < buddiesList.length; i += buddiesPerRow) {
      rows.push(buddiesList.slice(i, i + buddiesPerRow));
    }

    let rowsHTML = '';
    rows.forEach(row => {
      let rowContentHTML = '';
      row.forEach(filename => {
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
        const url = nameWithoutExt.startsWith('http://') || nameWithoutExt.startsWith('https://')
          ? nameWithoutExt
          : `https://${nameWithoutExt}`;

        rowContentHTML += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="buddy-link" title="${nameWithoutExt}"><img src="/assets/images/buddies/${filename}" alt="${nameWithoutExt}" class="buddy-img" onerror="this.parentNode.style.display='none'"></a>`;
      });

      rowsHTML += `<div class="buddy-box-row"><span class="buddy-border">║</span><div class="buddy-row-content">${rowContentHTML}</div><span class="buddy-border">║</span></div>`;
    });

    const borderLine = '═'.repeat(borderLength);
    const boxHTML = `<div class="buddy-box"><div class="buddy-box-header">╔${borderLine}╗</div>${rowsHTML}<div class="buddy-box-footer">╚${borderLine}╝</div></div>`;

    shell.print(boxHTML, 'color-text');
  }
};
