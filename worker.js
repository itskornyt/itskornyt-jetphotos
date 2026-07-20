/**
 * JetPhotos Unofficial API Proxy (Cloudflare Worker)
 */

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

    // If no keywords are provided, return a friendly message instead of letting JetPhotos 403 us
    if (!params.get('keywords')) {
        return new Response(JSON.stringify({
            message: "JetPhotos API Proxy is live! Please provide search parameters.",
            example: `${url.origin}/?keywords=HS-THB&keywords-type=reg`
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    const jetPhotosBaseUrl = "https://www.jetphotos.com/showphotos.php";
    const jetPhotosParams = new URLSearchParams();

    jetPhotosParams.set('page', params.get('page') || '1');
    jetPhotosParams.set('sort-order', params.get('sort-order') || '0');
    jetPhotosParams.set('keywords-contain', params.get('keywords-contain') || '3'); 
    jetPhotosParams.set('keywords-type', params.get('keywords-type') || 'all');
    jetPhotosParams.set('keywords', params.get('keywords') || '');
    jetPhotosParams.set('aircraft', params.get('aircraft') || 'all');
    jetPhotosParams.set('airline', params.get('airline') || 'all');
    jetPhotosParams.set('country-location', params.get('country') || 'all');
    jetPhotosParams.set('photo-year', params.get('year') || 'all');
    jetPhotosParams.set('photographer-group', params.get('photographer') || 'all');
    jetPhotosParams.set('category', params.get('category') || 'all');
    jetPhotosParams.set('width', params.get('width') || '');
    jetPhotosParams.set('height', params.get('height') || '');
    jetPhotosParams.set('genre', 'all');
    jetPhotosParams.set('search-type', 'Advanced');

    const jetPhotosUrl = `${jetPhotosBaseUrl}?${jetPhotosParams.toString()}`;

    try {
        const fetchHeaders = new Headers();
        fetchHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
        fetchHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        fetchHeaders.set('Referer', 'https://www.jetphotos.com/');

        // Using a robust proxy endpoint to mask the Cloudflare data-center IP
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(jetPhotosUrl)}`;

        const response = await fetch(proxyUrl, {
            headers: fetchHeaders
        });

        if (!response.ok) {
            return new Response(JSON.stringify({
                error: `Failed to fetch source data: ${response.status} ${response.statusText}`
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const html = await response.text();
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
                    this.currentStatText = '';
                    element.onEndTag(() => {
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
                    });
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
            error: 'Internal API Proxy Error',
            details: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}
 `https://www.jetphotos.com${this.currentLinkHref}` : 'N/A';
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

            // Accumulates all text inside a photo detail list item
            infoListTextAccumulator(textChunk) {
                if (this.isInsideInfoListItem) {
                    this.currentInfoListText += textChunk.text;
                }
            }

            // Handler for any link (`<a>` tag) found inside the detail list item
            linkInInfoTextElement(element) {
                if (this.currentPhoto && this.isInsideInfoListItem) {
                    this.currentLinkHref = element.getAttribute('href');
                    this.currentLinkText = ''; // Reset for this link's text
                }
            }

            // Accumulates text specifically within the link tag
            linkTextInInfoTextAccumulator(textChunk) {
                if (this.currentPhoto && this.isInsideInfoListItem && this.currentLinkHref) {
                    this.currentLinkText += textChunk.text;
                }
            }

            // Handler for the statistics elements (`.result__stat`)
            statElement(element) {
                if (this.currentPhoto) {
                    this.currentStatText = '';
                    element.onEndTag(() => {
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
                    });
                }
            }

            // Accumulates text inside the stats element
            statTextAccumulator(textChunk) {
                if (this.currentPhoto) {
                    this.currentStatText += textChunk.text;
                }
            }
        }

        const handler = new PhotoStreamHandler(photos);

        // Define which HTML elements and their contents should be processed
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

        // Return Final JSON Response
        return new Response(JSON.stringify({
            photos: photos,
            count: photos.length
        }), {
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });

    } catch (error) {
        console.error('Worker processing error:', error);
        return new Response(JSON.stringify({
            error: 'Internal API Proxy Error',
            details: error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}
