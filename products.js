import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import XLSX from 'xlsx';

puppeteer.use(StealthPlugin());

class AFAStoresScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.allProducts = [];
        this.filename = `afastores_products_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    async initialize() {
        this.browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await this.page.setViewport({ width: 1366, height: 768 });
        await this.page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async scrapeBrandCategories(brandUrl, brandName) {
        try {
            await this.page.goto(brandUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await this.delay(3000);
            await this.page.waitForSelector('a.facets-category-cell-anchor', { timeout: 30000 });

            const categoryLinks = await this.page.evaluate(() => Array.from(
                document.querySelectorAll('a.facets-category-cell-anchor'),
                el => ({
                    url: el.href.startsWith('http') ? el.href : 'https://www.afastores.com' + el.getAttribute('href'),
                    name: el.textContent.trim()
                })
            ));

            for (const category of categoryLinks) {
                await this.scrapeCategory(category, brandName);
                await this.delay(2000);
            }

        } catch (error) {
            console.error(`Error scraping brand ${brandName}:`, error.message);
        }
    }

    async scrapeCategory(category, brandName) {
        try {
            await this.page.goto(category.url, { waitUntil: 'networkidle2', timeout: 60000 });
            await this.delay(3000);

            let hasNextPage = true;
            let pageNumber = 1;
            const categoryProducts = [];

            while (hasNextPage) {
                try {
                    await this.page.waitForSelector('a.facets-item-cell-grid-title', { timeout: 30000 });

                    const productLinks = await this.page.evaluate(() => Array.from(
                        new Set(Array.from(document.querySelectorAll('a.facets-item-cell-grid-title'), el =>
                            el.href.startsWith('http') ? el.href : 'https://www.afastores.com' + el.getAttribute('href')))
                    ));

                    for (let i = 0; i < productLinks.length; i++) {
                        const productUrl = productLinks[i];
                        try {
                            const productData = await this.scrapeProductDetails(productUrl, category.name, brandName);
                            if (productData) {
                                categoryProducts.push(productData);
                                this.allProducts.push(productData);
                            }
                            await this.delay(1000);
                        } catch (err) {
                            console.error(`Error scraping product ${productUrl}:`, err.message);
                        }
                    }

                    hasNextPage = await this.page.evaluate(() => {
                        const nextBtn = document.querySelector('.next, [class*="next"], .pagination .next, a[rel="next"]');
                        return nextBtn && !nextBtn.classList.contains('disabled') && nextBtn.href;
                    });

                    if (hasNextPage) {
                        await this.page.click('.next, [class*="next"], .pagination .next, a[rel="next"]');
                        await this.delay(3000);
                        pageNumber++;
                    }
                } catch {
                    hasNextPage = false;
                }
            }

            if (categoryProducts.length === 0) {
                categoryProducts.push({ category: category.name, brand: brandName, sku: '', price: '', comment: '' });
                this.allProducts.push(...categoryProducts);
            }

            await this.saveCurrentDataToExcel();

        } catch (error) {
            console.error(`Error scraping category ${category.name}:`, error.message);
            this.allProducts.push({ category: category.name, brand: brandName, sku: '', price: '', comment: '' });
            await this.saveCurrentDataToExcel();
        }
    }

    async scrapeProductDetails(url, category, brand) {
        try {
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await this.delay(2000);

            return await this.page.evaluate((category, brand) => {
                const title = document.querySelector('h1')?.textContent.trim() || '';
                const sku = title.match(/.* - (.+)$/)?.[1]?.trim() || title.match(/([A-Z0-9-]+)\s*$/)?.[1] || '';
                const priceEl = document.querySelector("#product-details-full-form span[itemprop='price']")?.textContent.trim() || '';
                const price = priceEl ||
                    Array.from(document.querySelectorAll('[class*="price"]')).map(el => el.textContent.trim()).find(p => p.includes('$')) || '';
                const comment = document.querySelector('#special-coupon-message-container b')?.textContent.trim() || '';

                return { category, brand, sku, price, comment };
            }, category, brand);

        } catch {
            return { category, brand, sku: '', price: '', comment: '' };
        }
    }

    async saveCurrentDataToExcel() {
        const groupedData = {};
        this.allProducts.forEach(({ brand, category, sku, price, comment }) => {
            const key = `${brand} - ${category}`;
            if (!groupedData[key]) groupedData[key] = [];
            groupedData[key].push({ SKU: sku, 'Selling Price': price, Comment: comment });
        });

        const wb = XLSX.utils.book_new();
        Object.entries(groupedData).forEach(([sheetName, rows]) => {
            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 50 }];
            XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
        });

        XLSX.writeFile(wb, this.filename);
        console.log(`Excel file updated: ${this.filename}`);
    }

    async close() {
        if (this.browser) await this.browser.close();
    }

    async run() {
        try {
            await this.initialize();

            const brands = [
                // {
                //     name: 'Legacy Classic Furniture',
                //     url: 'https://www.afastores.com/brands/brands-legacy-classic-furniture'
                // },
                {
                    name: 'Martin Furniture',
                    url: 'https://www.afastores.com/brands/brands-martin-furniture'
                }
            ];

            for (const brand of brands) {
                await this.scrapeBrandCategories(brand.url, brand.name);
                await this.delay(3000);
            }

        } catch (err) {
            console.error('Error during scraping:', err);
        } finally {
            await this.close();
        }
    }
}

const scraper = new AFAStoresScraper();
scraper.run().then(() => console.log('Scraping completed!')).catch(console.error);

export default AFAStoresScraper;
