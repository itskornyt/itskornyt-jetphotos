addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: corsHeaders
        });
    }

    const url = new URL(request.url);
    const params = url.searchParams;

    const jetPhotosBaseUrl = "https://www.jetphotos.com/showphotos.php";
    const jetPhotosParams = new URLSearchParams();

    // Base defaults
    jetPhotosParams.set('page', '1');
    jetPhotosParams.set('sort-order', '0');
    jetPhotosParams.set('keywords-contain', '3');
    jetPhotosParams.set('keywords-type', 'all');
    jetPhotosParams.set('aircraft', 'all');
    jetPhotosParams.set('airline', 'all');
    jetPhotosParams.set('country-location', 'all');
    jetPhotosParams.set('photo-year', 'all');
    jetPhotosParams.set('photographer-group', 'all');
    jetPhotosParams.set('category', 'all');
    jetPhotosParams.set('genre', 'all');
    jetPhotosParams.set('search-type', 'Advanced');

    // Dynamically absorb everything you configured in BotGhost's URL Params menu
    for (const [key, value] of params.entries()) {
        if (key === 'country') {
            jetPhotosParams.set('country-location', value);
        } else if (key === 'year') {
            jetPhotosParams.set('photo-year', value);
        } else if (key === 'photographer') {
            jetPhotosParams.set('photographer-group', value);
        } else {
            jetPhotosParams.set(key, value);
        }
    }

    const jetPhotosUrl = `${jetPhotosBaseUrl}?${jetPhotosParams.toString()}`;

    try {
        // Using a cleaner protocol format for the wrapper to mask the cloudflare signature
        const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(jetPhotosUrl)}`;

        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        if (!response.ok) {
            return new Response(JSON.stringify({
                error: `Proxy layer failed: ${response.status} ${response.statusText}`
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const html = await response.text();
        
        if (html.includes('Checking your browser') || html.includes('cloudflare')) {
            return new Response(JSON.stringify({
                error: "Blocked by JetPhotos anti-bot firewall.",
                hint: "Try reducing the page range or resubmitting the request."
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const photos = [];

        class PhotoStreamHandler {
            constructor(photosArray) {
                this.photos = photosArray;
                this.currentPhoto = null;
                this.currentStatText = '';
                this.isInsideInfoListItem = false;
                this.currentInfoListText = '';
                this.currentLinkHref = '';
                this.currentLinkText = '';
            }

            divElement(element) {
                if (element.hasAttribute('data-photo')) {
                    this.currentPhoto = {
                        photoId: element.getAttribute('data-photo'),
                        thumbnailUrl: 'N/A',
                        imageUrl: 'N/A',
                        photoPageUrl: 'N/A',
                        registration: 'N/A',
                        registrationUrl: 'N/A',
                        aircraftType: 'N/A',
                        airline: 'N/A',
                        airlineUrl: 'N/A',
                        photographer: 'N/A',
                        photographerUrl: 'N/A',
                        location: 'N/A',
                        locationUrl: 'N/A',
                        photoDate: 'N/A',
                        uploadedDate: 'N/A',
                        likes: '0',
                        comments: '0',
                        views: '0'
                    };

                    element.onEndTag(() => {
                        if (this.currentPhoto) {
                            this.currentPhoto.aircraftType = this.currentPhoto.aircraftType.replace(/[\\/:*?"<>|]/g, '').trim() || 'Unknown';
                            this.photos.push(this.currentPhoto);
                            this.currentPhoto = null;
                        }
                    });
                }
            }

            imgElement(element) {
                if (this.currentPhoto) {
                    const src = element.getAttribute('src');
                    if (src) {
                        this.currentPhoto.thumbnailUrl = src.startsWith('//') ? `https:${src}` : src;
                        this.currentPhoto.imageUrl = this.currentPhoto.thumbnailUrl.replace('/400/', '/full/');
                    }
                    const altText = element.getAttribute('alt');
                    if (altText) {
                        const parts = altText.split('-').map(p => p.trim());
                        if (parts.length >= 3) {
                            this.currentPhoto.registration = parts[0];
                            this.currentPhoto.aircraftType = parts[1];
                            this.currentPhoto.airline = parts[2];
                        }
                    }
                }
            }

            photoLinkElement(element) {
                if (this.currentPhoto) {
                    const href = element.getAttribute('href');
                    if (href) {
                        this.currentPhoto.photoPageUrl = `https://www.jetphotos.com${href}`;
                    }
                }
            }

            infoListItemElement(element) {
                if (!this.currentPhoto) return;
                this.isInsideInfoListItem = true;
                this.currentInfoListText = '';
                this.currentLinkHref = '';
                this.currentLinkText = '';

                element.onEndTag(() => {
                    if (!this.currentPhoto) return;
                    this.isInsideInfoListItem = false;

                    const fullText = this.currentInfoListText.trim();
                    let valueToUse = this.currentLinkText ? this.currentLinkText.trim() : fullText;

                    if (!this.currentLinkText) {
                         if (fullText.includes('Reg:')) {
                             valueToUse = fullText.replace('Reg:', '').trim().split(' ')[0];
                         } else if (fullText.includes('Aircraft:')) {
                             valueToUse = fullText.replace('Aircraft:', '').trim();
                         } else if (fullText.includes('Airline:')) {
                             valueToUse = fullText.replace('Airline:', '').trim();
                         } else if (fullText.includes('Location:')) {
                             valueToUse = fullText.replace('Location:', '').trim();
                         } else if (fullText.includes('Photo date:')) {
                             valueToUse = fullText.replace('Photo date:', '').trim();
                         } else if (fullText.includes('Uploaded:')) {
                             valueToUse = fullText.replace('Uploaded:', '').trim();
                         } else if (fullText.includes('By:') || fullText.includes('Photographer:')) {
                             valueToUse = fullText.replace('By:', '').replace('Photographer:', '').trim();
                         }
                    }

                    if (fullText.includes('Reg:')) {
                        this.currentPhoto.registration = valueToUse;
                        this.currentPhoto.registrationUrl = this.currentLinkHref ? `https://www.jetphotos.com${this.currentLinkHref}` : 'N/A';
                    } else if (fullText.includes('Aircraft:')) {
                        this.currentPhoto.aircraftType = valueToUse;
                    } else if (fullText.includes('Airline:')) {
                        this.currentPhoto.airline = valueToUse;
                        this.currentPhoto.airlineUrl = this.currentLinkHref ? `https://www.jetphotos.com${this.currentLinkHref}` : 'N/A';
                    } else if (fullText.includes('Location:')) {
                        this.currentPhoto.location = valueToUse;
                        this.currentPhoto.locationUrl = this.currentLinkHref ? `https://www.jetphotos.com${this.currentLinkHref}` : 'N/A';
                    } else if (fullText.includes('Photo date:')) {
                        this.currentPhoto.photoDate = valueToUse;
                    } else if (fullText.includes('Uploaded:')) {
                        this.currentPhoto.uploadedDate = valueToUse;
                    } else if (fullText.includes('By:') || fullText.includes('Photographer:')) {
                        this.currentPhoto.photographer = valueToUse;
                        this.currentPhoto.photographerUrl = this.currentLinkHref ? `https://www.jetphotos.com${this.currentLinkHref}` : 'N/A';
                    }
                });
            }

            infoListTextAccumulator(textChunk) {
                if (this.isInsideInfoListItem) {
                    this.currentInfoListText += textChunk.text;
                }
            }

            linkInInfoTextElement(element) {
                if (this.currentPhoto && this.isInsideInfoListItem) {
                    this.currentLinkHref = element.getAttribute('href');
                    this.currentLinkText = '';
                }
            }

            linkTextInInfoTextAccumulator(textChunk) {
                if (this.currentPhoto && this.isInsideInfoListItem && this.currentLinkHref) {
                    this.currentLinkText += textChunk.text;
                }
            }

            statElement(element) {
                if (this.currentPhoto) {
                    const text = this.currentStatText;
                    const valueMatch = text.match(/\d+/);
                    const value = valueMatch ? valueMatch[0] : '0';

                    if (text.includes('Likes:')) {
                        this.currentPhoto.likes = value;
                    } else if (text.includes('Comments:')) {
                        this.currentPhoto.comments = value;
                    } else if (text.includes('Views:')) {
                        this.currentPhoto.views = value;
                    }
                }
            }

            statTextAccumulator(textChunk) {
                if (this.currentPhoto) {
                    this.currentStatText += textChunk.text;
                }
            }
        }

        const handler = new PhotoStreamHandler(photos);

        await new HTMLRewriter()
            .on('div[data-photo]', { element: handler.divElement.bind(handler) })
            .on('img.result__photo', { element: handler.imgElement.bind(handler) })
            .on('a.result__photoLink', { element: handler.photoLinkElement.bind(handler) })
            .on('.result__infoListText', {
                element: handler.infoListItemElement.bind(handler),
                text: handler.infoListTextAccumulator.bind(handler)
            })
            .on('.result__infoListText a', {
                element: handler.linkInInfoTextElement.bind(handler),
                text: handler.linkTextInInfoTextAccumulator.bind(handler)
            })
            .on('.result__stat', {
                element: handler.statElement.bind(handler),
                text: handler.statTextAccumulator.bind(handler)
            })
            .transform(new Response(html))
            .text();

        return new Response(JSON.stringify({
            photos: photos,
            count: photos.length
        }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Scraper execution error',
            details: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}
