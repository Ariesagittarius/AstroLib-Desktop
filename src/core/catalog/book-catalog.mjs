import fs from 'node:fs';
import path from 'node:path';
import { naturalSort } from '../../utils/natural-sort.ts';
import { cleanSlug } from '../../utils/slug.ts';
import { toCollectionRelativeSlug } from './content-paths.ts';

export function buildBookCatalog(directoryPath, options = {}) {
  const absolutePath = path.resolve(directoryPath);
  if (!fs.existsSync(absolutePath)) return [];

  const items = [];
  const files = fs.readdirSync(absolutePath);

  files.sort(naturalSort);

  for (const file of files) {
    const fullPath = path.join(absolutePath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {

      if (file !== 'images' && file !== '.git') {
        const subItems = buildBookCatalog(fullPath, options);
        if (subItems.length > 0) {
          let groupTitle = file.replace(/^\d+[_-]/, '').replace(/_/g, ' ');
          const matchedLang = options?.languages?.find(
            (l) => l.pathPrefix?.toLowerCase() === file.toLowerCase() || l.id?.toLowerCase() === file.toLowerCase()
          );
          if (matchedLang?.label) {
            groupTitle = matchedLang.label;
          } else if (file.toLowerCase() === 'zh') {
            groupTitle = '中文 (直译版)';
          } else if (file.toLowerCase() === 'zh-wp') {
            groupTitle = '中文 (王沛等译)';
          } else if (file.toLowerCase() === 'en') {
            groupTitle = '英文原版';
          }
          items.push({
            type: 'group',
            title: groupTitle,
            children: subItems,
          });
        }
      }
    } else if (file.endsWith('.mdx') || file.endsWith('.md')) {

      const content = fs.readFileSync(fullPath, 'utf-8');
      const titleMatch = content.match(/title:\s*['"](.*?)['"]/);
      const basename = path.basename(file, path.extname(file));
      let title = titleMatch ? titleMatch[1] : basename;

      if (/^\$?\d+\.\d+\.\d+\$?(\s*练习题)?$/.test(title.trim()) && /^\d+[\._-]/.test(basename)) {
        title = '§' + basename.replace(/_/g, ' ');
      }

      const rawSlug = toCollectionRelativeSlug(fullPath);
      const slug = cleanSlug(rawSlug);

      items.push({
        type: 'chapter',
        title,
        slug,
        filePath: path.relative(process.cwd(), fullPath).replace(/\\/g, '/'),
      });
    }
  }

  return items;
}
