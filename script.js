// ==========================================
// PRELOADER
// ==========================================
window.addEventListener('load', function() {
    const preloader = document.getElementById('preloader');
    if (preloader) {
        setTimeout(() => {
            preloader.classList.add('hidden');
            setTimeout(() => {
                preloader.style.display = 'none';
            }, 600);
        }, 2000);
    }
});

// ==========================================
// DARK MODE TOGGLE
// ==========================================
(function() {
    const saved = localStorage.getItem('gcbtp-theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

document.addEventListener('DOMContentLoaded', function() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        const updateIcon = () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        };
        updateIcon();

        themeToggle.addEventListener('click', function() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('gcbtp-theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('gcbtp-theme', 'dark');
            }
            updateIcon();
        });
    }
});

// ==========================================
// SCROLL PROGRESS BAR
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const progressBar = document.getElementById('scrollProgress');
    if (progressBar) {
        window.addEventListener('scroll', function() {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const scrollPercent = (scrollTop / docHeight) * 100;
            progressBar.style.width = scrollPercent + '%';
        });
    }
});

// ==========================================
// HERO PARTICLES
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const particlesContainer = document.getElementById('heroParticles');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (particlesContainer && !isMobile && !prefersReducedMotion) {
        for (let i = 0; i < 20; i++) {
            const particle = document.createElement('div');
            particle.classList.add('particle');
            const size = Math.random() * 6 + 2;
            particle.style.width = size + 'px';
            particle.style.height = size + 'px';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDuration = (Math.random() * 8 + 6) + 's';
            particle.style.animationDelay = (Math.random() * 5) + 's';
            particlesContainer.appendChild(particle);
        }
    }
});

// ==========================================
// TYPEWRITER EFFECT
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const heroH2 = document.querySelector('.hero-content h2');
    if (heroH2) {
        const fullText = heroH2.textContent;
        heroH2.textContent = '';
        heroH2.style.visibility = 'visible';

        const cursor = document.createElement('span');
        cursor.classList.add('typewriter-cursor');

        let i = 0;
        function type() {
            if (i < fullText.length) {
                heroH2.textContent = fullText.substring(0, i + 1);
                heroH2.appendChild(cursor);
                i++;
                setTimeout(type, 40);
            } else {
                setTimeout(() => { cursor.remove(); }, 3000);
            }
        }

        setTimeout(type, 2200);
    }
});

// ==========================================
// 3D TILT ON SERVICE CARDS
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    if (window.matchMedia('(max-width: 768px), (hover: none)').matches) return;
    const cards = document.querySelectorAll('.service-card');
    cards.forEach(card => {
        card.addEventListener('mousemove', function(e) {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = ((y - centerY) / centerY) * -8;
            const rotateY = ((x - centerX) / centerX) * 8;

            card.classList.add('tilting');
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-5px)`;
        });

        card.addEventListener('mouseleave', function() {
            card.classList.remove('tilting');
            card.style.transform = '';
        });
    });
});

// ==========================================
// ANIMATED COUNTERS
// ==========================================
(function() {
    let countersStarted = false;

    function animateCounter(el) {
        const target = parseInt(el.getAttribute('data-target'), 10) || 0;
        const duration = 1800;
        const startTime = Date.now();
        console.log('[Counter] animating', el, '→', target);
        (function step() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(eased * target);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = target;
            }
        })();
    }

    function startAll() {
        if (countersStarted) return;
        countersStarted = true;
        const counters = document.querySelectorAll('.counter');
        console.log('[Counter] found', counters.length, 'counter(s)');
        counters.forEach(animateCounter);
    }

    function checkScroll() {
        if (countersStarted) return;
        const statsSection = document.querySelector('.stats');
        if (!statsSection) return;
        const rect = statsSection.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top < vh - 50) startAll();
    }

    function init() {
        window.addEventListener('scroll', checkScroll, { passive: true });
        checkScroll();
        // Fallback inconditionnel : lance l'animation 1s après chargement même si hors écran
        setTimeout(startAll, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// ==========================================
// SECTION REVEAL ON SCROLL
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const sections = document.querySelectorAll('.services, .mission, .about, .projects, .stats, .team, .devis, .carrieres, .testimonials, .faq, .cta-band');
    sections.forEach(section => section.classList.add('reveal-section'));

    const revealObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08 });

    sections.forEach(section => revealObserver.observe(section));
});

// Navigation mobile
document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    // Vérifier que les éléments existent
    if (!hamburger || !navMenu) {
        console.warn('Hamburger menu elements not found');
        return;
    }

    // Toggle mobile menu
    hamburger.addEventListener('click', function(e) {
        e.stopPropagation();
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });

    // Close mobile menu when clicking on a link
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });

    // Fermer le menu si on clique en dehors
    document.addEventListener('click', function(e) {
        if (!hamburger.contains(e.target) && !navMenu.contains(e.target)) {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        }
    });

    // Smooth scrolling for navigation links (sécurisé)
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            // Scroll fluide UNIQUEMENT pour les ancres internes
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const targetSection = document.querySelector(href);
                if (targetSection) {
                    const offsetTop = targetSection.offsetTop - 80; // Account for fixed header
                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });
                }
            }
            // Pour tout autre lien (ex: contact.html), navigation normale
        }, false);
    });

    // Header background on scroll
    const header = document.querySelector('.header');
    window.addEventListener('scroll', function() {
        if (window.scrollY > 100) {
            header.style.background = 'rgba(255, 255, 255, 0.98)';
            header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.15)';
        } else {
            header.style.background = 'rgba(255, 255, 255, 0.95)';
            header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.1)';
        }
    });

    // Intersection Observer for animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe elements for animation
    const animatedElements = document.querySelectorAll('.service-card, .project-card, .stat-item');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // Counter animation for stats
    const statNumbers = document.querySelectorAll('.stat-item h3');
    const statsSection = document.querySelector('.stats');

    const statsObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                statNumbers.forEach(stat => {
                    const target = parseInt(stat.textContent.replace('+', ''));
                    animateCounter(stat, target);
                });
                statsObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    statsObserver.observe(statsSection);

    // Counter animation function
    function animateCounter(element, target) {
        let current = 0;
        const increment = target / 50;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            element.textContent = '+' + Math.floor(current);
        }, 30);
    }

    // Form handling for contact/devis
    const contactForms = document.querySelectorAll('form');
    contactForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            
            // Simple validation
            let isValid = true;
            Object.keys(data).forEach(key => {
                if (!data[key] || data[key].trim() === '') {
                    isValid = false;
                }
            });
            
            if (isValid) {
                // Show success message
                showNotification('Message envoyé avec succès!', 'success');
                form.reset();
            } else {
                showNotification('Veuillez remplir tous les champs', 'error');
            }
        });
    });

    // Notification system
    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.right = '20px';
        notification.style.padding = '15px 20px';
        notification.style.borderRadius = '5px';
        notification.style.color = 'white';
        notification.style.fontWeight = '600';
        notification.style.zIndex = '10000';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'transform 0.3s ease';
        
        if (type === 'success') {
            notification.style.background = '#28a745';
        } else if (type === 'info') {
            notification.style.background = '#17a2b8';
        } else {
            notification.style.background = '#dc3545';
        }
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    // Service modal system
    function showServiceModal(title, description) {
        // Créer l'overlay
        const overlay = document.createElement('div');
        overlay.className = 'service-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

        // Créer la modal
        const modal = document.createElement('div');
        modal.className = 'service-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 15px;
            padding: 30px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            position: relative;
            transform: scale(0.8);
            transition: transform 0.3s ease;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        `;

        // Contenu de la modal
        modal.innerHTML = `
            <button class="modal-close" style="
                position: absolute;
                top: 15px;
                right: 20px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                transition: color 0.3s ease;
            ">&times;</button>
            <div class="modal-content">
                <h2 style="
                    color: #1a5f7a;
                    margin-bottom: 20px;
                    font-size: 28px;
                    font-weight: 700;
                ">${title}</h2>
                <div class="modal-description" style="
                    color: #333;
                    line-height: 1.6;
                    margin-bottom: 25px;
                    font-size: 16px;
                ">${getDetailedServiceDescription(title)}</div>
                <div class="modal-features" style="
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 25px;
                ">
                    <h3 style="color: #1a5f7a; margin-bottom: 15px; font-size: 20px;">Nos Expertises</h3>
                    <ul style="list-style: none; padding: 0;">
                        ${getServiceFeatures(title)}
                    </ul>
                </div>
                <div class="modal-cta" style="text-align: center;">
                    <a href="contact.html" style="
                        display: inline-block;
                        background: linear-gradient(135deg, #1a5f7a, #2c88a8);
                        color: white;
                        padding: 15px 30px;
                        border-radius: 25px;
                        text-decoration: none;
                        font-weight: 600;
                        transition: transform 0.3s ease;
                        box-shadow: 0 4px 15px rgba(26, 95, 122, 0.3);
                    ">Demander un Devis</a>
                </div>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Animer l'ouverture
        setTimeout(() => {
            overlay.style.opacity = '1';
            modal.style.transform = 'scale(1)';
        }, 10);

        // Gestionnaire de fermeture
        const closeModal = () => {
            overlay.style.opacity = '0';
            modal.style.transform = 'scale(0.8)';
            setTimeout(() => {
                document.body.removeChild(overlay);
            }, 300);
        };

        // Événements de fermeture
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeModal();
            }
        });

        // Fermeture avec Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Hover effect sur le bouton CTA
        const ctaButton = modal.querySelector('.modal-cta a');
        ctaButton.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        ctaButton.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    }

    // Fonction pour obtenir la description détaillée du service
    function getDetailedServiceDescription(serviceTitle) {
        const descriptions = {
            'Structure du Bâtiment': `
                <p>Notre expertise en structure du bâtiment couvre tous les aspects de l'ingénierie structurelle moderne. Nous concevons et calculons des structures robustes, durables et économiques.</p>
                <p>Nos ingénieurs maîtrisent les dernières normes de construction et utilisent des logiciels de pointe pour garantir la sécurité et l'optimisation de vos projets.</p>
            `,
            'Lots Techniques du Bâtiment': `
                <p>Nous nous spécialisons dans la conception et l'optimisation des systèmes techniques du bâtiment. Notre approche intègre l'efficacité énergétique et le confort des occupants.</p>
                <p>De la climatisation à la ventilation, en passant par les réseaux de fluides, nous assurons une coordination parfaite entre tous les lots techniques.</p>
            `,
            'VRD': `
                <p>Nos services VRD (Voirie et Réseaux Divers) couvrent la conception complète des infrastructures extérieures. Nous optimisons la circulation et l'accessibilité de vos projets.</p>
                <p>De l'éclairage public à l'électrification extérieure, nous créons des espaces fonctionnels et esthétiques qui s'intègrent parfaitement à l'environnement urbain.</p>
            `
        };
        return descriptions[serviceTitle] || `<p>${serviceTitle} - Service professionnel de haute qualité pour tous vos besoins en ingénierie.</p>`;
    }

    // Fonction pour obtenir les fonctionnalités du service
    function getServiceFeatures(serviceTitle) {
        const features = {
            'Structure du Bâtiment': [
                'Calcul de structures en béton armé',
                'Conception de structures métalliques',
                'Analyse sismique et parasismique',
                'Dimensionnement des fondations',
                'Études de stabilité et de résistance',
                'Optimisation des coûts de construction'
            ],
            'Lots Techniques du Bâtiment': [
                'Conception CVC (Chauffage, Ventilation, Climatisation)',
                'Réseaux de fluides (eau, gaz, électricité)',
                'Études thermiques et énergétiques',
                'Systèmes de sécurité incendie',
                'Automatisation et domotique',
                'Certification énergétique'
            ],
            'VRD': [
                'Conception de voirie et espaces publics',
                'Éclairage public et signalisation',
                'Réseaux d\'assainissement et eaux pluviales',
                'Électrification extérieure',
                'Aménagement paysager technique',
                'Accessibilité PMR et normes'
            ]
        };
        
        const serviceFeatures = features[serviceTitle] || ['Service professionnel', 'Expertise technique', 'Accompagnement personnalisé'];
        
        return serviceFeatures.map(feature => `
            <li style="
                padding: 8px 0;
                border-bottom: 1px solid #e9ecef;
                position: relative;
                padding-left: 25px;
            ">
                <i class="fas fa-check" style="
                    color: #28a745;
                    position: absolute;
                    left: 0;
                    top: 8px;
                "></i>
                ${feature}
            </li>
        `).join('');
    }

    // Lazy loading for images (if any are added later)
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    images.forEach(img => imageObserver.observe(img));

    // Parallax effect for hero section
    const hero = document.querySelector('.hero');
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const rate = scrolled * -0.5;
        hero.style.transform = `translateY(${rate}px)`;
    });

    // Add loading animation
    window.addEventListener('load', function() {
        document.body.classList.add('loaded');
    });

    // Service card hover effects
    const serviceCards = document.querySelectorAll('.service-card');
    serviceCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-15px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });

    // Project card click handlers
    const projectCards = document.querySelectorAll('.project-card');
    projectCards.forEach(card => {
        card.addEventListener('click', function() {
            const projectName = this.querySelector('h4').textContent;
            showNotification(`Projet ${projectName} - Détails à venir`, 'info');
        });
    });

    // Service "Voir Plus" button handlers
    const serviceLinks = document.querySelectorAll('.service-link');
    serviceLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const serviceCard = this.closest('.service-card');
            const serviceTitle = serviceCard.querySelector('h3').textContent;
            const serviceDescription = serviceCard.querySelector('p').textContent;
            
            // Créer une modal avec les détails du service
            showServiceModal(serviceTitle, serviceDescription);
        });
    });

    // Back to top button
    const backToTopBtn = document.createElement('button');
    backToTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    backToTopBtn.className = 'back-to-top';
    backToTopBtn.style.cssText = `
        position: fixed;
        bottom: 165px;
        right: 25px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #1a5f7a, #2c88a8);
        color: white;
        border: none;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 999;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.18);
        font-size: 18px;
    `;
    
    document.body.appendChild(backToTopBtn);
    
    // Show/hide back to top button
    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            backToTopBtn.style.opacity = '1';
            backToTopBtn.style.visibility = 'visible';
        } else {
            backToTopBtn.style.opacity = '0';
            backToTopBtn.style.visibility = 'hidden';
        }
    });
    
    // Back to top functionality
    backToTopBtn.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

});

// Old preloader replaced by new version at top of file

// --- Loupe de zoom sur toutes les images de projets du site (.project-gallery-row img et .project-img-container img) ---
document.addEventListener('DOMContentLoaded', function () {
  const galleryImages = document.querySelectorAll('.project-gallery-row img, .project-img-container img');

  galleryImages.forEach(img => {
    // Créer la loupe
    const magnifier = document.createElement('div');
    magnifier.classList.add('magnifier-glass');
    // S'assurer que le parent est positionné en relative
    const parent = img.parentElement;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(magnifier);

    let zoom = 2;
    let magnifierSize = 120;

    img.addEventListener('mousemove', moveMagnifier);
    img.addEventListener('mouseenter', showMagnifier);
    img.addEventListener('mouseleave', hideMagnifier);

    function showMagnifier(e) {
      magnifier.style.display = 'block';
      magnifier.style.backgroundImage = `url('${img.src}')`;
    }
    function hideMagnifier(e) {
      magnifier.style.display = 'none';
    }
    function moveMagnifier(e) {
      const rect = img.getBoundingClientRect();
      // Position du curseur par rapport à l'image, même avec scroll
      let x = e.pageX - window.scrollX - rect.left;
      let y = e.pageY - window.scrollY - rect.top;
      // Calculer la position idéale (sous le curseur)
      let left = x - magnifierSize / 2;
      let top = y - magnifierSize / 2;
      // Si la loupe sort, la coller au bord
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left > img.width - magnifierSize) left = img.width - magnifierSize;
      if (top > img.height - magnifierSize) top = img.height - magnifierSize;
      magnifier.style.left = left + 'px';
      magnifier.style.top = top + 'px';
      // Déplacer l'arrière-plan pour l'effet de zoom
      const bgX = ((x / img.width) * 100);
      const bgY = ((y / img.height) * 100);
      magnifier.style.backgroundSize = `${img.width * zoom}px ${img.height * zoom}px`;
      magnifier.style.backgroundPosition = `${bgX}% ${bgY}%`;
    }
  });
});

// Système "Voir plus" / "Voir moins" pour mobile
document.addEventListener('DOMContentLoaded', function() {
    // Fonction pour initialiser le système "Voir plus" pour un élément
    function initReadMore(element, maxHeight) {
        if (!element) return;
        
        // Vérifier si on est sur mobile
        const isMobile = window.innerWidth <= 768;
        if (!isMobile) {
            // Sur desktop, s'assurer que tout est visible
            element.classList.remove('collapsed');
            element.style.maxHeight = '';
            return;
        }
        
        // Attendre un peu pour que le DOM soit complètement rendu
        setTimeout(function() {
            // Vérifier si le contenu dépasse la hauteur maximale
            const originalHeight = element.scrollHeight;
            if (originalHeight <= maxHeight) {
                element.classList.remove('collapsed');
                element.style.maxHeight = '';
                return;
            }
            
            // Vérifier si un bouton existe déjà
            const existingButton = element.nextElementSibling;
            if (existingButton && existingButton.classList.contains('read-more-btn')) {
                return; // Déjà initialisé
            }
            
            // Ajouter la classe collapsed
            element.classList.add('collapsed');
            element.style.maxHeight = maxHeight + 'px';
            element.style.transition = 'max-height 0.3s ease';
            
            // Créer le bouton "Voir plus"
            const button = document.createElement('button');
            button.className = 'read-more-btn';
            button.innerHTML = 'Voir plus <i class="fas fa-chevron-down"></i>';
            button.setAttribute('aria-label', 'Afficher plus de contenu');
            button.setAttribute('type', 'button');
            
            // Insérer le bouton après l'élément
            element.parentNode.insertBefore(button, element.nextSibling);
            
            // Stocker la hauteur originale
            element.dataset.originalHeight = originalHeight;
            
            // Gérer le clic sur le bouton
            button.addEventListener('click', function() {
                const storedHeight = parseInt(element.dataset.originalHeight) || originalHeight;
                
                if (element.classList.contains('collapsed')) {
                    // Afficher tout le contenu
                    element.classList.remove('collapsed');
                    element.style.maxHeight = storedHeight + 'px';
                    button.innerHTML = 'Voir moins <i class="fas fa-chevron-up"></i>';
                    button.classList.add('expanded');
                } else {
                    // Réduire le contenu
                    element.classList.add('collapsed');
                    element.style.maxHeight = maxHeight + 'px';
                    button.innerHTML = 'Voir plus <i class="fas fa-chevron-down"></i>';
                    button.classList.remove('expanded');
                }
            });
        }, 100);
    }
    
    // Initialiser pour les descriptions des membres de l'équipe
    // Afficher uniquement le premier paragraphe, cacher les autres
    const memberDescriptions = document.querySelectorAll('.member-description');
    memberDescriptions.forEach(function(desc) {
        const paragraphs = desc.querySelectorAll('p');
        
        // Si il y a plus d'un paragraphe
        if (paragraphs.length > 1) {
            // Cacher tous les paragraphes sauf le premier
            for (let i = 1; i < paragraphs.length; i++) {
                paragraphs[i].classList.add('hidden-paragraph');
            }
            
            // Vérifier si un bouton existe déjà
            const existingButton = desc.querySelector('.member-read-more-btn');
            if (existingButton) {
                return; // Déjà initialisé
            }
            
            // Créer le bouton "Voir plus" après le premier paragraphe
            const button = document.createElement('button');
            button.className = 'read-more-btn member-read-more-btn';
            button.innerHTML = 'Voir plus <i class="fas fa-chevron-down"></i>';
            button.setAttribute('aria-label', 'Afficher plus de contenu');
            button.setAttribute('type', 'button');
            
            // Insérer le bouton après le premier paragraphe
            paragraphs[0].parentNode.insertBefore(button, paragraphs[1]);
            
            // Gérer le clic sur le bouton
            button.addEventListener('click', function() {
                const hiddenParagraphs = desc.querySelectorAll('p.hidden-paragraph');
                
                if (hiddenParagraphs.length > 0 && !hiddenParagraphs[0].classList.contains('show')) {
                    // Afficher tous les paragraphes cachés
                    hiddenParagraphs.forEach(function(p) {
                        p.classList.add('show');
                    });
                    button.innerHTML = 'Voir moins <i class="fas fa-chevron-up"></i>';
                    button.classList.add('expanded');
                } else {
                    // Cacher tous les paragraphes sauf le premier
                    hiddenParagraphs.forEach(function(p) {
                        p.classList.remove('show');
                    });
                    button.innerHTML = 'Voir plus <i class="fas fa-chevron-down"></i>';
                    button.classList.remove('expanded');
                }
            });
        }
    });
    
    // Initialiser pour l'intro de l'équipe
    const teamIntro = document.querySelector('.team-intro');
    if (teamIntro) {
        initReadMore(teamIntro, 150);
    }
    
    // Initialiser pour la description "Qui Sommes-Nous"
    const aboutDescription = document.querySelector('.about-description');
    if (aboutDescription) {
        initReadMore(aboutDescription, 200);
    }
    
    // Initialiser pour toute la section about-text (contenu complet)
    const aboutText = document.querySelector('.about-text');
    if (aboutText) {
        initReadMore(aboutText, 250);
    }
    
    // Réinitialiser lors du redimensionnement de la fenêtre
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            // Supprimer tous les boutons existants
            document.querySelectorAll('.read-more-btn').forEach(function(btn) {
                btn.remove();
            });
            
            // Supprimer les classes collapsed
            document.querySelectorAll('.collapsed').forEach(function(el) {
                el.classList.remove('collapsed');
                el.style.maxHeight = '';
            });
            
            // Réinitialiser les descriptions des membres
            memberDescriptions.forEach(function(desc) {
                const paragraphs = desc.querySelectorAll('p');
                const button = desc.querySelector('.member-read-more-btn');
                
                if (paragraphs.length > 1) {
                    // Cacher tous les paragraphes sauf le premier
                    for (let i = 1; i < paragraphs.length; i++) {
                        paragraphs[i].classList.add('hidden-paragraph');
                        paragraphs[i].classList.remove('show');
                    }
                    
                    if (button) {
                        button.innerHTML = 'Voir plus <i class="fas fa-chevron-down"></i>';
                        button.classList.remove('expanded');
                    }
                }
            });
            if (teamIntro) initReadMore(teamIntro, 150);
            if (aboutDescription) initReadMore(aboutDescription, 200);
            if (aboutText) initReadMore(aboutText, 250);
        }, 250);
    });
}); 